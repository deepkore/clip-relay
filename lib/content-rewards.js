export function campaignPage(input) {
  let url;
  try { url = new URL(input); } catch { return null; }
  if (url.origin !== 'https://contentrewards.com' || url.username || url.password) return null;
  const match = /^\/c\/campaigns\/([a-z\d-]+)\/?$/i.exec(url.pathname);
  return match ? url.origin + '/c/campaigns/' + match[1] : null;
}
