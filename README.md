# ClipRelay

A single-operator publishing workspace for LLM agents. Vercel serves the dashboard and API. PostgreSQL stores channel metadata, campaign selections, publishing state, OAuth attempts, and login sessions. Social credentials are encrypted within database records. A private Cloudflare R2 bucket holds videos under each channel folder. An agent drives the publishing steps and can resume using the same request ID.

The dashboard creates a server-side session when you unlock it. Its HttpOnly, SameSite cookie lasts 30 days, survives refresh and OAuth navigation, and is revoked by **Sign out**. Use the same app origin throughout login and YouTube authorization. Localhost and ngrok have separate cookies. Changing ADMIN_TOKEN invalidates existing sessions.

YouTube publishing uses `googleapis` and `google-auth-library`, with persisted resumable sessions and 8 MiB chunks. **Publish** drives the upload and processing checks automatically while Activity is open; after an error, use **Retry publishing** to resume the saved upload. Activity shows uploaded progress and waits for YouTube to finish processing and confirm public visibility before marking the video published or submitting its link.

### Publishing activity status badges

The **Status** column uses colored badges with text labels:

| Color | Statuses |
|---|---|
| Green | Delivered, Published, Uploaded |
| Amber | Awaiting submission, Awaiting publication, Awaiting publish, Awaiting upload |
| Blue | Publishing, Submitting, Processing on YouTube |
| Purple | Scheduled |
| Orange | Check submission |
| Red | Submission failed, Needs attention |
| Gray | Unrecognized statuses |

The **Campaign** column shows the campaign name/link without a status badge or status text. **Resolve** remains available there when a submission needs checking. The same display applies to recent activity on the overview page. Uploaded confirms the upload stage only; Delivered confirms receipt of a submission, not campaign approval or payment.

YouTube uploads target Shorts: ClipRelay checks the MP4's displayed dimensions (including rotation) and duration before uploading. Use a square or vertical, non-fragmented MP4 no longer than 180 seconds. YouTube classifies qualifying uploads automatically; its API has no Shorts switch. ClipRelay returns a `/shorts/{videoId}` link after processing. See [YouTube's Shorts requirements](https://support.google.com/youtube/answer/15424877). If Google restricts an API upload to private visibility, Activity asks you to resolve visibility in YouTube Studio and Continue; it retains the uploaded video ID.

## Setup checklist

Run commands from the project root using Node.js 22.13 or later on the 22.x line. On Windows, use `npm.cmd` instead of `npm` if PowerShell blocks the npm script.

1. Install the dashboard/API dependencies:

   ```sh
   npm ci --include=dev
   ```

2. For a new installation, copy `.env.example` to `.env` and fill in the environment variables listed below. Do not overwrite an existing `.env`. Set `DATABASE_URL`, the R2 credentials, `ADMIN_TOKEN`, `ENCRYPTION_KEY`, Google OAuth credentials, and `APP_URL`. Register `<APP_URL>/api/v1/oauth/youtube/callback` in Google Cloud. Keep the existing encryption key when upgrading.

3. Create the PostgreSQL tables:

   ```sh
   npm run db:setup
   ```

   Database setup connects to the database in `.env` and creates missing tables and indexes.

4. Start the dashboard:

   ```sh
   npm run dev
   ```

   This terminal stays running. Open `http://127.0.0.1:3000`, or your configured ngrok origin when using ngrok for OAuth. Unlock with `ADMIN_TOKEN`. Use the same origin throughout login and YouTube authorization. Restart the server after changing `.env` or backend code.

5. In **Reward accounts**, add each Content Rewards account with its own stable ID. First complete the standalone [worker setup](home-worker/README.md). Then sign in once per account:

   ```sh
   npm --prefix home-worker run login -- creator-a
   npm --prefix home-worker run login -- creator-b
   ```

   Replace these example IDs with the IDs you created. Each command opens a separate saved browser profile; sign into the matching account and press Enter in the terminal. Old shared browser logins are not reused. The worker uses installed Google Chrome with its sandbox enabled by default; install Chrome separately on the worker machine.

6. Add or edit channels, select their reward account, save, connect YouTube, and add campaign URLs. Multiple channels may share a reward account, but a channel cannot switch reward accounts after assignment. Create a channel API key under **API keys**. Set `RELAY_URL` and that channel's `RELAY_KEY` in the upload agent's environment before publishing videos.

7. Run the checks when verifying an installation or code change:

   ```sh
   npm test
   npm --prefix home-worker run test:browser
   ```

   The browser check uses an intercepted test form; it does not submit to a real campaign. The PostgreSQL integration test is skipped unless `TEST_DATABASE_URL` is set to a test database in the process environment. `npm test` does not automatically load `.env`.

## npm script reference

These are all scripts currently defined in `package.json`:

| Command | Purpose | When to use |
|---|---|---|
| `npm run dev` | Start the local dashboard and API; loads `.env` if present. | Local development; keep its terminal running. |
| `npm run db:setup` | Create the PostgreSQL records table and index if missing; requires `.env`. | Before first live use of a database. |
| `npm --prefix home-worker run login -- <reward-account-id>` | Open the account's persistent browser profile for interactive sign-in. | Once per reward account, or when its login expires. |
| `npm test` | Run automated tests with simulated publishing providers and optional test-database coverage. | Verification after code changes. |

The standalone worker handles browser submission automatically after publication. New Instagram account setup remains deferred.

`npm ci --include=dev` installs dependencies and is an npm built-in, not a project script. There are no `npm run build`, `npm start`, or `npm run deploy` scripts; Vercel serves `public` and the API using `vercel.json`. Run the Playwright worker on your computer or a VPS with persistent browser profiles.

## Standalone home worker

The browser worker is now a separate application in [home-worker](home-worker/README.md). It has its own package, environment file, startup task and tests, and can be copied to another PC without the server code. See that README for direct IP setup and migration.

Set the server's `HOME_WORKER_URL` to `http://YOUR_REACHABLE_IP:4317/home-worker/webhook` and set the same `HOME_WORKER_SECRET` in both apps. Set a separate `CLIPRELAY_SECRET` in both apps for signed worker callbacks (at least 32 characters and different from `HOME_WORKER_SECRET`); per-account worker keys are no longer used. The dashboard server no longer proxies worker traffic. The worker keeps a local queue, browser profiles and duplicate-submission protection.

### Windows automatic startup and queue controls

The `ClipRelay Home Worker` scheduled task starts the worker **when its Windows user signs in**, not at power-on before sign-in. Keep the PC signed in, awake and connected to the network. The launcher runs in the background; submission browser windows remain visible. Logs are stored in `%LOCALAPPDATA%\ClipRelay\logs`.

For first-time installation, stop any manually running worker, then run `npm --prefix home-worker run install:startup` from the project root. This installs the sign-in task and starts it immediately. For an existing task, use PowerShell:

```powershell
# Enable future automatic startup (does not start another worker now).
Enable-ScheduledTask -TaskName 'ClipRelay Home Worker'

# Inspect the task and default worker port before starting.
Get-ScheduledTask -TaskName 'ClipRelay Home Worker'
Get-NetTCPConnection -State Listen -LocalPort 4317 -ErrorAction SilentlyContinue

# Start now only if no worker is already running.
Start-ScheduledTask -TaskName 'ClipRelay Home Worker'

# Turn off future startup and stop the task-managed worker/queue processing.
Disable-ScheduledTask -TaskName 'ClipRelay Home Worker'
Stop-ScheduledTask -TaskName 'ClipRelay Home Worker'
```

A worker started manually with `npm --prefix home-worker start` is separate from the scheduled task; stop that terminal with Ctrl+C. Disabling the task alone does not stop a running worker. Queue processing runs inside the worker, so stopping every worker instance stops queue processing and webhook acceptance. Saved queue items are preserved and eligible pending items resume when the worker restarts; stopping does not clear the queue or cancel server-side publishing.

`EADDRINUSE: address already in use 0.0.0.0:4317` means another process already owns the port. Check the listener's `OwningProcess` and identify it before stopping anything. Use one worker instance: either the scheduled task or a manual terminal. See the [worker operations guide](home-worker/README.md#windows-startup-and-stopping-the-queue) for troubleshooting and queue storage details.

## PostgreSQL setup

Set DATABASE_URL to your PostgreSQL connection string. Keep the existing ENCRYPTION_KEY so saved credentials can be decrypted.

```sh
npm run db:setup
npm run dev
```

All application records, upload logs and sessions are stored in PostgreSQL. There is no R2 metadata fallback when the database is unavailable. R2 stores only video and thumbnail files. Keep DATABASE_URL configured on every server instance.

The database uses a primary key and version checks to prevent concurrent updates from silently overwriting each other. Metadata is stored in JSONB rows, which PostgreSQL can query, and credentials are encrypted separately inside those rows. Take database backups and retain the encryption key with your secure deployment secrets.

For an optional database integration test, set TEST_DATABASE_URL to a test PostgreSQL database and run `node --test test/database.test.js`. The test rolls back its changes.

## Run locally

Use Node.js 22.13 or later on the 22.x line.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. Without the required environment settings, the dashboard displays a sample workspace. Preview changes live in the current tab. For live local use, copy `.env.example` to `.env`, fill in the settings, and restart. Run `npm test` to exercise the publishing flow with simulated providers.

## Deploy on Vercel

1. Create a private R2 bucket. Create an R2 S3 access key with Object Read & Write permission restricted to that bucket. Keep public access disabled. Agent uploads and Instagram retrieval use signed URLs.
2. Put this project in a Git repository and import the repository root into Vercel. Use the **Other** framework preset, Node.js **22.x**, and the included `vercel.json`. The static output is `public` and the Node function is `api/relay.js`. No frontend build command is needed.
3. Add the environment variables below to the production environment and deploy. Use separate buckets and credentials for any live preview deployments.
4. Open the deployed URL and choose **Unlock workspace**. Enter the admin token, add a channel, and configure its accounts. In **API keys**, generate a key for that channel and give it to the agent.

| Variable | Purpose |
|---|---|
| DATABASE_URL | PostgreSQL connection string for application records and sessions. |
| ADMIN_TOKEN | Random administrator secret of at least 24 characters. Generate a random 32-byte hex string. |
| ENCRYPTION_KEY | Separate, permanent 64-character hex key for AES-256-GCM encryption. Back it up securely. Existing records require this key. |
| R2_ACCOUNT_ID, R2_BUCKET | Cloudflare account ID and private bucket name. |
| R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY | Bucket-scoped S3 credentials. |
| GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET | Web OAuth client for the Connect YouTube flow. |
| APP_URL | Exact application origin, such as https://your-app.vercel.app. Used for the OAuth callback. |
| META_GRAPH_VERSION | Facebook Graph API version supported by your Meta app. Defaults to v23.0. |
| CAMPAIGN_WEBHOOK_HOSTS | Comma-separated exact HTTPS hostnames allowed to receive campaign payloads. Used only for the optional webhook integration. |

Generate ADMIN_TOKEN and ENCRYPTION_KEY independently with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep both in your password manager and Vercel's environment settings.

## Connect accounts

- **YouTube.** Enable YouTube Data API v3 in Google Cloud, configure the OAuth consent screen, and create a **Web application** OAuth client. Add `<APP_URL>/api/v1/oauth/youtube/callback` as an authorized redirect URI. Set `APP_URL`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` in Vercel. For local development, use `http://127.0.0.1:3000` as APP_URL and register that exact callback address. Save a channel in ClipRelay, open it, and click **Connect YouTube**. Select the Google or Brand account and grant upload and read-only channel access. ClipRelay displays the connected channel name and encrypts its refresh token in PostgreSQL. If your consent app is in Testing, add your Google account as a test user. Testing-mode grants can require frequent reconnection. [Google authorization guide](https://developers.google.com/identity/protocols/oauth2/web-server)
- **Instagram.** New account setup is deferred.
- **R2 folders.** The first upload for a channel creates an object such as `podpulse/<campaign-name>/<video-name>.mp4`. The agent receives a 15-minute, create-only upload URL. [Cloudflare signed URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)

## Run an agent upload

Set `RELAY_URL` to the deployed origin and `RELAY_KEY` to the channel key in the agent's environment. Run:

```sh
node examples/post-video.js podpulse ./highlight.mp4 "Episode highlight" "A moment from the show"
```

This publishes to all accounts configured on the channel. The script prints a request UUID before uploading. To resume an interrupted run, set `VIDEO_REQUEST_ID` to that UUID and run the same command again with the same file and metadata. Treat a UUID as permanently assigned to one clip. The app accepts MP4s up to 1 GiB for publishing.

### Agent HTTP contract

See [API_DOCUMENTATION.md](API_DOCUMENTATION.md) for the complete endpoint reference, request/response examples, and full JSON body schemas.

Send `Authorization: Bearer <channel key>` to the ClipRelay API. For JSON bodies, send `Content-Type: application/json`.

1. `POST /api/v1/videos` with a stable UUID in `Idempotency-Key` and a JSON body such as `{"channel":"podpulse","title":"Episode highlight","caption":"A moment from the show","platforms":["youtube","instagram"]}`. The response includes `id`, `objectKey`, `uploadUrl`, `headers`, and `platforms`.
2. `PUT` the raw MP4 bytes to `uploadUrl` with exactly the returned upload headers. Omit the ClipRelay bearer token. A 412 on retry means an object already exists for that request.
3. For each requested platform, call `POST /api/v1/videos/{id}/publish/{platform}` repeatedly. Send an empty JSON object. One call advances one step, including up to 8 MiB of a YouTube resumable upload. Wait 10 seconds between steps and back off on transient failures. The example drives these steps automatically.
4. `GET /api/v1/videos/{id}` returns per-platform state, errors, and post URLs. Terminal successes are **Delivered**, **Published**, and **Awaiting submission**. For browser campaigns, **Awaiting submission** hands the post to the Playwright worker. **Check submission** requires checking the campaign receipt in Activity. If an Instagram publish response is lost, verify the published Reel and attach its permalink in Activity before continuing. The dashboard also allows advancing a step manually.

## Content Rewards browser submission

Create each reward account in the dashboard, assign channels, connect YouTube, and select campaign URLs. In the standalone worker, configure `REWARD_ACCOUNT_IDS` and sign in with `npm run login -- <account-id>`. Each account retains its own persistent Chrome profile. Channel ownership remains permanent.

After publication the API sends the link to the worker. It checks the authoritative job, submits only pending campaigns and reports results. If a submission outcome is uncertain, inspect Content Rewards and use Activity → Resolve. Delivered means submission received, not campaign approval or payment.

See [worker setup](home-worker/README.md) for IP connectivity, commands and migration.

## Alternative webhook integration

In the channel settings, supply a campaign ID, a provider-compatible submission webhook (or your adapter URL), and an optional bearer token. Add the receiver's hostname to the allowlist. These settings are captured for each new video. ClipRelay sends one JSON POST per published platform:

```json
{"submission_id":"<video-id>-instagram","campaign_id":"campaign-123","channel":"podpulse","platform":"instagram","post_url":"https://www.instagram.com/reel/example/","video_id":"<video-id>"}
```

The receiver must deduplicate by the `Idempotency-Key` header or `submission_id`, submit using the rewards provider's authorized mechanism, and return a 2xx response after accepting the submission. On failure the job retains its social link for retry. **Delivered** records the receiver's acceptance. Campaign approval and payout are tracked by the rewards provider. A provider that requires a different schema needs an adapter. A campaign landing-page URL alone cannot receive these API submissions.

## Video and thumbnail uploads

Create one job per video with the same saved `Idempotency-Key` UUID on every retry:

```json
{
  "channel": "podpulse",
  "title": "Episode highlight",
  "hookText": "You will want to see this moment",
  "description": "An episode highlight about the topic.",
  "instagramDescription": "Watch this highlight! #clips",
  "youtubeDescription": "An extended description for YouTube.",
  "campaignName": "summer-campaign",
  "videoFileName": "clip-001.mp4",
  "thumbnailFileName": "clip-001-cover.jpg",
  "platforms": ["youtube"]
}
```

Send this to `POST /api/v1/videos`. `channel` is the channel's stable folder slug. `campaignName` selects a named campaign saved on the channel and also supplies the R2 campaign folder. The API resolves the URL automatically; uploads do not need to send campaignUrl. Names are matched case-insensitively, and the saved spelling is used for the folder. Unknown names are rejected. Folder and filenames must not contain slashes or `..`. Use unique filenames per channel/campaign. A conflicting job gets HTTP 409 rather than reusing another video's files.

The response contains `id` (existing job/request UUID), `uploadId` (UUID generated by PostgreSQL), `objectKey`, `uploadUrl`, `headers`, and an optional `thumbnail` object with its own `objectKey`, `uploadUrl`, and `headers`. PUT the MP4 and JPG separately to their signed R2 URLs with exactly the returned headers. Do not send the channel bearer token to R2.

Files are stored as `podpulse/summer-campaign/clip-001.mp4` and `podpulse/summer-campaign/clip-001-cover.jpg`. Both URLs are create-only and expire after 15 minutes; repeat the creation request with the same key and metadata to refresh them. Thumbnail storage is supported here; automatic assignment as a YouTube custom thumbnail is not part of this upload operation.

After PUTs, call `POST /api/v1/videos/{id}/upload-complete` with `{}`. The API checks R2 object metadata and stores per-file presence, byte sizes and validity in `cliprelay_uploads`. Overall status is `pending`, `partial`, `invalid`, or `uploaded`. It marks uploaded only when all requested assets exist with the expected content type and valid size (MP4 up to 1 GiB, JPG up to 10 MiB). A completion call is required after direct R2 upload; R2 does not automatically update PostgreSQL. Publishing also verifies uploads before beginning. An R2/network error does not mark the upload successful.

Read the persistent log with `GET /api/v1/uploads/{uploadId}` or `GET /api/v1/videos/{id}/upload-log`, using the channel key. The pending row exists before uploading so interrupted uploads remain traceable. Existing videos keep their old paths and IDs; old records are not backfilled. For video-only calls without filenames, new jobs use a campaign folder and a UUID filename.

Run `npm run db:setup` to add the upload-log table before restarting the API. The example agent supports `CAMPAIGN_NAME` and `THUMBNAIL_FILE` environment variables, uploads both files, verifies completion, then publishes. Keep `VIDEO_REQUEST_ID` unchanged on retries.

`hookText` (up to 500 characters), `description` (up to 5,000 characters), `caption` (up to 2,200 characters), `youtubeDescription` (up to 5,000 characters), `instagramDescription` (up to 2,200 characters), `campaignName` (up to 150 characters), `videoFileName` (must end in `.mp4`), and `thumbnailFileName` (must end in `.jpg`) are all strictly required for creating video jobs via `POST /api/v1/videos`. The example agent (`examples/post-video.js`) reads them via CLI arguments and environment variables (`CAMPAIGN_NAME`, `THUMBNAIL_FILE`, `HOOK_TEXT`, `VIDEO_DESCRIPTION`, `INSTAGRAM_DESCRIPTION`, `YOUTUBE_DESCRIPTION`).

New videos select one configured campaign using `campaignName`. A legacy `campaignUrl` string is still accepted, but must match the selected name if both are supplied. Omitting both selects the channel's sole campaign; channels with several campaigns require a selection. A legacy `campaignUrls` array is accepted only with zero or one URL; multiple selections and sending both fields are rejected. Existing multi-campaign jobs remain readable and resumable.

Channel create/edit requests accept named campaigns:

```json
{"campaigns":[{"name":"summer-campaign","url":"https://contentrewards.com/c/campaigns/summer"}]}
```

Channel settings provide Add campaign and Remove campaign controls with separate name and URL inputs. Names and URLs must each be unique within a channel. Existing URL-only configurations are presented with names derived from their URL slugs and can be renamed. New jobs capture the resolved URL; retries and existing jobs retain their original mapping after channel edits. No database schema migration is needed.
