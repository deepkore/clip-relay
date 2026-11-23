# Graph Report - ClippingPostingSoftware  (2026-11-23)

## Corpus Check
- 35 files · ~14,708 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: .graphify-bak 1, .example 1, (none) 1)

## Summary
- 211 nodes · 550 edges · 11 communities (10 shown, 1 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `721d8168`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- reward-profiles.test.js
- relay.js
- app.js
- relay.test.js
- package.json
- youtube-publish.js
- read
- database.js
- auth.js
- vercel.json
- oauth-complete.js

## God Nodes (most connected - your core abstractions)
1. `run()` - 41 edges
2. `fail()` - 36 edges
3. `read()` - 17 edges
4. `save()` - 17 edges
5. `render()` - 12 edges
6. `finishYouTube()` - 11 edges
7. `edit()` - 10 edges
8. `finishInstagram()` - 10 edges
9. `startInstagram()` - 10 edges
10. `bindYouTube()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `string()` --calls--> `fail()`  [EXTRACTED]
  api/relay.js → lib/storage.js
- `normalizeUrls()` --calls--> `fail()`  [EXTRACTED]
  api/relay.js → lib/storage.js
- `run()` --calls--> `checkBrowserRequest()`  [EXTRACTED]
  api/relay.js → lib/auth.js
- `run()` --calls--> `login()`  [EXTRACTED]
  api/relay.js → lib/auth.js
- `run()` --calls--> `logout()`  [EXTRACTED]
  api/relay.js → lib/auth.js

## Import Cycles
- None detected.

## Communities (11 total, 1 thin omitted)

### Community 0 - "reward-profiles.test.js"
Cohesion: 0.14
Nodes (3): handler(), files, [channel, file, thumbnailFileArg, campaignNameArg, title, captionArg]

### Community 1 - "relay.js"
Cohesion: 0.15
Nodes (29): campaignList(), normalizeUrls(), platforms, publicChannel(), publicJob(), run(), same(), string() (+21 more)

### Community 2 - "app.js"
Cohesion: 0.13
Nodes (30): api(), campaignRow(), cards(), channels, connect(), edit(), editReward(), esc() (+22 more)

### Community 3 - "relay.test.js"
Cohesion: 0.15
Nodes (8): sendHomeWebhook(), verifyWebhook(), webhookSignature(), workerPayload(), call(), objects, records, uploadLogs

### Community 4 - "package.json"
Cohesion: 0.09
Nodes (26): dependencies, @aws-sdk/client-s3@^3.1163.0, @aws-sdk/s3-request-presigner@^3.1163.0, google-auth-library@^11.3.4, googleapis@^190.0.0, mp4box@^2.5.0, pg@^8.23.1, devDependencies (+18 more)

### Community 5 - "youtube-publish.js"
Cohesion: 0.26
Nodes (12): youtubeClient(), advance(), checked(), instagram(), validateEndpoint(), inspectShorts(), shortsMetadata(), downloadURL() (+4 more)

### Community 6 - "read"
Cohesion: 0.30
Nodes (15): config(), cookie(), digest(), finishInstagram(), startInstagram(), bindYouTube(), rewardAccount(), read() (+7 more)

### Community 7 - "database.js"
Cohesion: 0.26
Nodes (12): createUploadLog(), databasePool(), error(), listRecords(), readRecord(), readUploadLog(), saveRecord(), schema (+4 more)

### Community 8 - "auth.js"
Cohesion: 0.47
Nodes (7): checkBrowserRequest(), login(), logout(), sameSecret(), sessionFor(), setCookie(), tokenFrom()

### Community 10 - "vercel.json"
Cohesion: 0.22
Nodes (8): maxDuration, crons, framework, functions, api/relay.js, headers, outputDirectory, rewrites

## Knowledge Gaps
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createPublisher()` connect `app.js` to `relay.test.js`?**
  _High betweenness centrality (0.122) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `run()` (e.g. with `publicChannel()` and `publicJob()`) actually correct?**
  _`run()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `reward-profiles.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._
- **Why does `fail()` connect `youtube-publish.js` to `auth.js`, `relay.js`, `read`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.13368983957219252 - nodes in this community are weakly interconnected._
- **Why does `google-auth-library` connect `package.json` to `youtube-publish.js`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Should `relay.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.14855072463768115 - nodes in this community are weakly interconnected._