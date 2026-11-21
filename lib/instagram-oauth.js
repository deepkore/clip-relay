import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { read, save, fail } from './storage.js';

const digest = value => createHash('sha256').update(value).digest();

function config() {
  const origin = new URL(process.env.APP_URL || '');
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) {
    throw fail(503, 'APP_URL must use HTTPS or local development HTTP.');
  }
  const clientId = process.env.META_CLIENT_ID || process.env.META_APP_ID || '2290127438585993';
  const configId = process.env.META_CONFIG_ID || '1550515130504470';
  const clientSecret = process.env.META_CLIENT_SECRET || process.env.META_APP_SECRET;
  const version = process.env.META_GRAPH_VERSION || 'v23.0';

  if (!clientId) throw fail(503, 'Configure META_CLIENT_ID in the server environment.');
  return {
    origin: origin.origin,
    redirect: origin.origin + '/api/v1/oauth/instagram/callback',
    secure: origin.protocol === 'https:',
    clientId,
    configId,
    clientSecret,
    version
  };
}

function cookie(state, value, secure, maxAge) {
  return 'ig_' + state + '=' + value + '; Path=/api/v1/oauth/instagram/callback; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (secure ? '; Secure' : '');
}

export async function startInstagram(slug, res) {
  let settings;
  try {
    settings = config();
  } catch (e) {
    throw e.status ? e : fail(503, 'Set APP_URL to this app’s origin in the server environment.');
  }

  const { value: channel, tag } = await read('channels/' + slug);
  const state = randomBytes(32).toString('hex');
  const browser = randomBytes(32).toString('hex');

  await save('oauth/' + state, {
    slug,
    platform: 'instagram',
    browserHash: digest(browser).toString('hex'),
    expires: Date.now() + 600000
  });

  channel.instagramPending = state;
  await save('channels/' + slug, channel, tag);

  res.setHeader('Set-Cookie', cookie(state, browser, settings.secure, 600));

  const url = new URL('https://www.facebook.com/dialog/oauth');
  const params = {
    client_id: settings.clientId,
    config_id: settings.configId,
    display: 'popup',
    override_default_response_type: 'true',
    redirect_uri: settings.redirect,
    response_type: 'code',
    state,
    prompt: 'login'
  };
  url.search = new URLSearchParams(params).toString();

  return { url: url.toString() };
}

export async function finishInstagram(req, res, url) {
  const settings = config();
  try {
    const state = url.searchParams.get('state') || '';
    if (!/^[a-f0-9]{64}$/.test(state)) throw fail(400, 'Invalid connection state.');

    const { value: pending, tag } = await read('oauth/' + state);
    const browser = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('ig_' + state + '='))?.split('=')[1];

    if (!browser || pending.used || pending.expires < Date.now() || !timingSafeEqual(digest(browser), Buffer.from(pending.browserHash, 'hex'))) {
      throw fail(400, 'Connection expired. Start again from the channel.');
    }

    await save('oauth/' + state, { ...pending, used: true }, tag);
    res.setHeader('Set-Cookie', cookie(state, '', settings.secure, 0));

    if (url.searchParams.has('error')) {
      const desc = url.searchParams.get('error_description') || url.searchParams.get('error_message') || 'Instagram connection was cancelled or permission was declined.';
      throw fail(400, desc);
    }

    const code = url.searchParams.get('code');
    if (!code) throw fail(400, 'Meta did not return an authorization code.');

    if (!settings.clientSecret) {
      throw fail(503, 'Configure META_CLIENT_SECRET in the server environment to complete connection.');
    }

    // Exchange authorization code for user access token
    const tokenUrl = new URL(`https://graph.facebook.com/${settings.version}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      redirect_uri: settings.redirect,
      code
    }).toString();

    const tokenRes = await fetch(tokenUrl, { signal: AbortSignal.timeout(15000) });
    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      throw fail(502, err.error?.message || 'Meta could not complete authorization. Reconnect Instagram.');
    }
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw fail(502, 'Meta did not return an access token.');

    let accessToken = tokenData.access_token;

    // Exchange for long-lived user token
    try {
      const longLivedUrl = new URL(`https://graph.facebook.com/${settings.version}/oauth/access_token`);
      longLivedUrl.search = new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        fb_exchange_token: accessToken
      }).toString();
      const longLivedRes = await fetch(longLivedUrl, { signal: AbortSignal.timeout(15000) });
      if (longLivedRes.ok) {
        const longLivedData = await longLivedRes.json();
        if (longLivedData.access_token) accessToken = longLivedData.access_token;
      }
    } catch {
      // Continue with original token if exchange fails
    }

    // Retrieve Facebook Pages and attached Instagram Professional accounts
    const accountsUrl = new URL(`https://graph.facebook.com/${settings.version}/me/accounts`);
    accountsUrl.search = new URLSearchParams({
      fields: 'id,name,access_token,instagram_business_account{id,username,name}',
      access_token: accessToken
    }).toString();

    const accountsRes = await fetch(accountsUrl, { signal: AbortSignal.timeout(15000) });
    let igAccount = null;
    let finalToken = accessToken;

    if (accountsRes.ok) {
      const accountsData = await accountsRes.json();
      const pages = accountsData.data || [];
      const matchingPage = pages.find(p => p.instagram_business_account?.id);
      if (matchingPage) {
        igAccount = matchingPage.instagram_business_account;
        // Page access tokens derived from a long-lived user token never expire
        if (matchingPage.access_token) finalToken = matchingPage.access_token;
      }
    }

    // Fallback: check /me if user logged in directly with an Instagram account
    if (!igAccount?.id) {
      const meUrl = new URL(`https://graph.facebook.com/${settings.version}/me`);
      meUrl.search = new URLSearchParams({
        fields: 'id,name,username,instagram_business_account{id,username,name}',
        access_token: accessToken
      }).toString();
      const meRes = await fetch(meUrl, { signal: AbortSignal.timeout(15000) });
      if (meRes.ok) {
        const meData = await meRes.json();
        if (meData.instagram_business_account?.id) {
          igAccount = meData.instagram_business_account;
        }
      }
    }

    if (!igAccount?.id) {
      throw fail(400, 'No linked Instagram Professional (Creator/Business) account found. Connect your Instagram account to a Facebook Page and reconnect.');
    }

    const { value: channel, tag: channelTag } = await read('channels/' + pending.slug);
    if (channel.instagramPending !== state) {
      throw fail(409, 'A newer connection was started. Complete the latest connection.');
    }

    channel.instagram = finalToken;
    channel.instagramId = igAccount.id;
    channel.instagramTitle = igAccount.username ? `@${igAccount.username}` : (igAccount.name || 'Instagram');
    delete channel.instagramPending;

    await save('channels/' + pending.slug, channel, channelTag);

    res.statusCode = 303;
    res.setHeader('Location', '/oauth-complete.html?platform=instagram&result=connected');
    res.end();
  } catch (e) {
    const message = e.status ? e.message : 'Instagram connection failed. Try connecting again.';
    res.statusCode = 303;
    res.setHeader('Location', '/oauth-complete.html?platform=instagram&error=' + encodeURIComponent(message));
    res.end();
  }
}
