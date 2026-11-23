# ClipRelay API Documentation

This document describes all API endpoints, request headers, JSON request body schemas, and response formats for ClipRelay.

---

## Base URL & Authentication

All API endpoints are prefixed with `/api/v1/`.

### Authentication Types

| Token Type | Header Format | Use Case |
|---|---|---|
| **Channel API Key (`RELAY_KEY`)** | `Authorization: Bearer cr_<channel>.<hex>` | Used by video upload agents and automated clipping scripts to upload and publish videos for a specific channel. |
| **Admin Token (`ADMIN_TOKEN`)** | `Authorization: Bearer <ADMIN_TOKEN>` | Used for dashboard management, channel creation, and triggering cron jobs. |
| **Vercel Cron Secret (`CRON_SECRET`)** | `Authorization: Bearer <CRON_SECRET>` | Sent automatically by Vercel's automated cron service. |

---

## 1. Video Upload & Publishing Endpoints

### `POST /api/v1/videos` (Create Video & Get Upload URLs)
Creates a video publishing job in PostgreSQL and returns 15-minute presigned Cloudflare R2 URLs for direct file upload.

#### Request Headers
```http
Authorization: Bearer <channel-key or admin-token>
Idempotency-Key: <unique-lowercase-uuid>
Content-Type: application/json
```
> [!IMPORTANT]
> `Idempotency-Key` must be a valid lowercase UUID (e.g., `c29a8f40-3b91-4d1a-8260-29c8e4e9f7a1`). Always reuse the same UUID on retries to resume without creating duplicate jobs.

#### JSON Request Body Fields

> [!IMPORTANT]
> All 10 metadata and file fields are **strictly required**. Requests missing any of these fields will be rejected with `HTTP 400 Bad Request`.

| Field | Type | Required? | Max Length | Description |
|---|---|---|---|---|
| `channel` | string | **Yes** | 48 chars | Channel slug (e.g. `"podpulse"`). Must match the Channel API key scope. |
| `title` | string | **Yes** | 100 chars | Video title on YouTube / Instagram. |
| `campaignName` | string | **Yes** | 150 chars | Name of the campaign configured on this channel (e.g. `"summer-campaign"`). |
| `videoFileName` | string | **Yes** | 150 chars | Custom video filename stored in R2. Must end in `.mp4` (e.g. `"clip-001.mp4"`). |
| `thumbnailFileName` | string | **Yes** | 150 chars | Custom thumbnail filename stored in R2. Must end in `.jpg` (e.g. `"cover-001.jpg"`). |
| `caption` | string | **Yes** | 2,200 chars | Video caption used as fallback description. |
| `description` | string | **Yes** | 5,000 chars | General video description metadata. |
| `hookText` | string | **Yes** | 500 chars | Short hook/teaser text metadata. |
| `youtubeDescription` | string | **Yes** | 5,000 chars | YouTube-specific description (overrides caption for YouTube Shorts). |
| `instagramDescription` | string | **Yes** | 2,200 chars | Instagram-specific caption (overrides caption for Instagram Reels). |
| `platforms` | string[] | No | 2 items | Optional array of target platforms: `["youtube"]`, `["instagram"]`, or `["youtube", "instagram"]`. Defaults to all connected platforms on the channel. |
| `campaignUrl` | string | No | 4,096 chars | Content Rewards campaign URL. Optional if `campaignName` is provided (resolved automatically). |

#### Example Request Body (All Required Fields)
```json
{
  "channel": "podpulse",
  "title": "5 Productivity Hacks That Actually Work",
  "caption": "Quick productivity tips to save time every day.",
  "hookText": "Stop wasting hours on useless tasks.",
  "description": "Comprehensive productivity breakdown for modern creators.",
  "youtubeDescription": "Here are 5 science-backed productivity hacks that will save you 10+ hours a week.\n\nSubscribe for more weekly tips!\n#shorts #productivity #efficiency",
  "instagramDescription": "Which hack is your favorite? Save this Reel for later! 💡 #productivitytips #focus #lifehacks",
  "campaignName": "summer-campaign",
  "videoFileName": "productivity-hack-01.mp4",
  "thumbnailFileName": "productivity-hack-01-thumb.jpg",
  "platforms": ["youtube"]
}
```

#### Example Response (`200 OK`)
```json
{
  "id": "c29a8f40-3b91-4d1a-8260-29c8e4e9f7a1",
  "uploadId": "f768b940-1234-4a56-b789-0abcdef12345",
  "campaignName": "summer-campaign",
  "campaignUrl": "https://contentrewards.com/c/campaigns/summer",
  "hookText": "Stop wasting hours on useless tasks.",
  "description": "Comprehensive productivity breakdown for modern creators.",
  "instagramDescription": "Which hack is your favorite? Save this Reel for later! 💡 #productivitytips #focus #lifehacks",
  "youtubeDescription": "Here are 5 science-backed productivity hacks...",
  "objectKey": "podpulse/summer-campaign/productivity-hack-01.mp4",
  "uploadUrl": "https://<account>.r2.cloudflarestorage.com/bucket/podpulse/summer-campaign/productivity-hack-01.mp4?X-Amz-Algorithm=...",
  "headers": {
    "Content-Type": "video/mp4",
    "If-None-Match": "*"
  },
  "thumbnail": {
    "objectKey": "podpulse/summer-campaign/productivity-hack-01-thumb.jpg",
    "uploadUrl": "https://<account>.r2.cloudflarestorage.com/bucket/podpulse/summer-campaign/productivity-hack-01-thumb.jpg?X-Amz-Algorithm=...",
    "headers": {
      "Content-Type": "image/jpeg",
      "If-None-Match": "*"
    }
  },
  "platforms": ["youtube"]
}
```

---

### Step 2: Upload Files to Cloudflare R2 (`PUT <uploadUrl>`)
Upload the binary file directly to the returned `uploadUrl`.
* **Method:** `PUT`
* **URL:** Use the exact `uploadUrl` string returned by the API.
* **Headers:** Send exactly the returned `headers` (e.g. `Content-Type: video/mp4`, `If-None-Match: *`).
* **Important:** **Do NOT** include the `Authorization` header in this PUT request to Cloudflare R2.
* Repeat for `thumbnail.uploadUrl` if uploading a thumbnail.

---

### `POST /api/v1/videos/:id/upload-complete` (Verify Upload)
Verifies that the video and optional thumbnail exist in Cloudflare R2 with valid byte sizes and content types.

#### Request Headers
```http
Authorization: Bearer <channel-key or admin-token>
Content-Type: application/json
```
#### Request Body
```json
{}
```

#### Example Response (`200 OK`)
```json
{
  "id": "f768b940-1234-4a56-b789-0abcdef12345",
  "jobId": "c29a8f40-3b91-4d1a-8260-29c8e4e9f7a1",
  "status": "uploaded",
  "assets": {
    "video": {
      "key": "podpulse/summer-campaign/productivity-hack-01.mp4",
      "uploaded": true,
      "status": "uploaded",
      "bytes": 24589120
    },
    "thumbnail": {
      "key": "podpulse/summer-campaign/productivity-hack-01-thumb.jpg",
      "uploaded": true,
      "status": "uploaded",
      "bytes": 312450
    }
  }
}
```

---

### `POST /api/v1/videos/:id/publish/:platform` (Publish Immediately)
Advances publishing for the specified platform (`youtube` or `instagram`).

#### Request URL & Headers
* **URL:** `/api/v1/videos/<id>/publish/youtube` or `/api/v1/videos/<id>/publish/instagram`
* **Headers:**
  ```http
  Authorization: Bearer <channel-key or admin-token>
  Content-Type: application/json
  ```
#### Request Body
```json
{}
```

#### Example Response (`200 OK`)
```json
{
  "id": "c29a8f40-3b91-4d1a-8260-29c8e4e9f7a1",
  "title": "5 Productivity Hacks That Actually Work",
  "targets": {
    "youtube": {
      "status": "Published",
      "url": "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "uploadConfirmed": true,
      "uploadStatus": "processed",
      "publishedAt": "2026-11-23T12:00:00.000Z",
      "submissions": [
        {
          "campaignUrl": "https://contentrewards.com/c/campaigns/summer",
          "status": "Delivered"
        }
      ]
    }
  }
}
```

---

### `GET /api/v1/videos/:id` (Get Video Status & Details)
Polls the latest status of a video job.

#### Request Headers
```http
Authorization: Bearer <channel-key or admin-token>
```

#### Example Response (`200 OK`)
```json
{
  "id": "c29a8f40-3b91-4d1a-8260-29c8e4e9f7a1",
  "title": "5 Productivity Hacks That Actually Work",
  "channel": "podpulse",
  "campaignName": "summer-campaign",
  "created": "2026-11-23T10:00:00.000Z",
  "scheduledAt": "2026-11-24T00:30:00.000Z",
  "targets": {
    "youtube": {
      "status": "Scheduled",
      "scheduledAt": "2026-11-24T00:30:00.000Z",
      "totalBytes": 24589120,
      "uploadedBytes": 24589120,
      "shorts": {
        "width": 1080,
        "height": 1920,
        "duration": 45,
        "format": "shorts"
      }
    }
  }
}
```

#### Possible `targets[platform].status` Values:
* `Awaiting publish`: Video is uploaded to R2 and waiting in the queue.
* `Scheduled`: Selected by the scheduler to post at `scheduledAt`.
* `Publishing` / `Processing on YouTube`: Streaming chunks to YouTube or waiting for Shorts processing.
* `Published`: Video is publicly live on YouTube Shorts / Instagram Reel.
* `Delivered`: Published URL has been submitted to Content Rewards.
* `Needs attention`: Error encountered (e.g. YouTube quota or video rejected).

---

## 2. Automated Daily Cron Endpoints

### `POST /api/v1/cron/publish` (Trigger Publishing Run)
Runs the daily publication for due videos, or forces publication of the next queued video.

#### Request Headers
```http
Authorization: Bearer <ADMIN_TOKEN or CRON_SECRET>
Content-Type: application/json
```

#### Query Parameters / Body Options

| Parameter / Body Field | Type | Description |
|---|---|---|
| `now` / `force` | boolean | If `true`, immediately bypasses the daily limit and scheduled time, publishing the next candidate video right now. |

#### Example 1: Run Due Scheduled Videos (Default)
```http
POST /api/v1/cron/publish
```
```json
{}
```

#### Example 2: Force Publish Next Queued Video Immediately
```http
POST /api/v1/cron/publish?now=true
```
or with body:
```json
{
  "now": true
}
```

#### Example Response (`200 OK`)
```json
{
  "ok": true,
  "publishedCount": 1,
  "published": [
    {
      "id": "c29a8f40-3b91-4d1a-8260-29c8e4e9f7a1",
      "title": "5 Productivity Hacks That Actually Work",
      "platform": "youtube",
      "url": "https://www.youtube.com/shorts/dQw4w9WgXcQ"
    }
  ],
  "errors": []
}
```

---

### `POST /api/v1/cron/schedule` (Pre-select Today's Videos)
Scans campaigns, selects 1 video per campaign (oldest in queue &ndash; FIFO), and marks it `Scheduled` with target timestamp (`00:30 UTC` on weekdays, `02:30 UTC` on weekends).

#### Request Headers
```http
Authorization: Bearer <ADMIN_TOKEN or CRON_SECRET>
```

#### Example Response (`200 OK`)
```json
{
  "ok": true,
  "scheduledCount": 1,
  "scheduled": [
    {
      "id": "c29a8f40-3b91-4d1a-8260-29c8e4e9f7a1",
      "title": "5 Productivity Hacks That Actually Work",
      "campaign": "summer-campaign",
      "channel": "podpulse",
      "scheduledAt": "2026-11-24T00:30:00.000Z"
    }
  ]
}
```

---

## 3. Channel Management Endpoints

### `POST /api/v1/channels` (Create or Edit Channel)
Creates a channel or updates an existing channel's metadata and campaign mappings.

#### Request Headers
```http
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json
```

#### JSON Request Body Fields

| Field | Type | Required? | Description |
|---|---|---|---|
| `slug` | string | **Yes** | Unique channel identifier / folder name (e.g. `"podpulse"`). Lowercase letters, numbers, hyphens. |
| `name` | string | **Yes** | Display name of the channel. |
| `rewardAccountId` | string | No | Content Rewards account ID assigned to this channel. |
| `campaigns` | object[] | No | Array of campaign objects: `[{"name": "summer", "url": "https://..."}]`. |

#### Example Request Body
```json
{
  "slug": "podpulse",
  "name": "PodPulse Channel",
  "rewardAccountId": "creator-a",
  "campaigns": [
    {
      "name": "summer-campaign",
      "url": "https://contentrewards.com/c/campaigns/summer-2026"
    }
  ]
}
```

---

### `POST /api/v1/channels/:slug/key` (Generate Channel API Key)
Generates or regenerates a channel API key (`cr_<slug>.<hex>`).

#### Request Headers
```http
Authorization: Bearer <ADMIN_TOKEN>
```
#### Request Body
```json
{}
```

#### Example Response (`200 OK`)
```json
{
  "key": "cr_podpulse.4e9a8f1029c8e7d6b5a43210feebda9812345678abcdef0123456789abcdef01"
}
```
Use this `key` as the `RELAY_KEY` in upload agents and automated clipping scripts.
