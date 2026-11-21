# Graph Report - ClippingPostingSoftware  (2026-11-21)

## Corpus Check
- 45 files · ~15,354 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: .example 2, .graphify-bak 1, (none) 1)

## Summary
- 267 nodes · 666 edges · 12 communities (9 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- home.js
- relay.js
- app.js
- relay.test.js
- package.json
- youtube-publish.js
- home-worker/package.json
- database.js
- vercel.json
- oauth-complete.js

## God Nodes (most connected - your core abstractions)
1. `run()` - 40 edges
2. `fail()` - 36 edges
3. `read()` - 17 edges
4. `save()` - 17 edges
5. `render()` - 12 edges
6. `finishYouTube()` - 11 edges
7. `finishInstagram()` - 10 edges
8. `startInstagram()` - 10 edges
9. `bindYouTube()` - 10 edges
10. `startYouTube()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `run()` --calls--> `sendHomeWebhook()`  [EXTRACTED]
  api/relay.js → lib/home-webhook.js
- `run()` --calls--> `advance()`  [EXTRACTED]
  api/relay.js → lib/publish.js
- `run()` --calls--> `validateEndpoint()`  [EXTRACTED]
  api/relay.js → lib/publish.js
- `run()` --calls--> `verifyWebhook()`  [EXTRACTED]
  api/relay.js → lib/worker-protocol.js
- `run()` --calls--> `workerPayload()`  [EXTRACTED]
  api/relay.js → lib/worker-protocol.js

## Import Cycles
- None detected.

## Communities (12 total, 3 thin omitted)

### Community 0 - "home.js"
Cohesion: 0.08
Nodes (30): files, [channel, file, title, caption='',...campaignUrls], browserProfile(), hasBrowserProfile(), login(), pause(), profilePath(), rejectPageError() (+22 more)

### Community 1 - "relay.js"
Cohesion: 0.11
Nodes (52): campaignList(), handler(), normalizeUrls(), platforms, publicChannel(), publicJob(), run(), same() (+44 more)

### Community 2 - "app.js"
Cohesion: 0.13
Nodes (30): api(), campaignRow(), cards(), channels, connect(), edit(), editReward(), esc() (+22 more)

### Community 3 - "relay.test.js"
Cohesion: 0.18
Nodes (8): sendHomeWebhook(), verifyWebhook(), webhookSignature(), workerPayload(), call(), objects, records, uploadLogs

### Community 4 - "package.json"
Cohesion: 0.09
Nodes (26): dependencies, @aws-sdk/client-s3@^3.1163.0, @aws-sdk/s3-request-presigner@^3.1163.0, google-auth-library@^11.3.4, googleapis@^190.0.0, mp4box@^2.5.0, pg@^8.23.1, devDependencies (+18 more)

### Community 5 - "youtube-publish.js"
Cohesion: 0.23
Nodes (11): youtubeClient(), advance(), checked(), instagram(), validateEndpoint(), inspectShorts(), shortsMetadata(), downloadURL() (+3 more)

### Community 6 - "home-worker/package.json"
Cohesion: 0.12
Nodes (17): dependencies, playwright@^1.65.0, engines, node, playwright, name, private, scripts (+9 more)

### Community 7 - "database.js"
Cohesion: 0.24
Nodes (13): createUploadLog(), databasePool(), error(), listRecords(), readRecord(), readUploadLog(), saveRecord(), schema (+5 more)

### Community 10 - "vercel.json"
Cohesion: 0.22
Nodes (8): maxDuration, crons, framework, functions, api/relay.js, headers, outputDirectory, rewrites

## Knowledge Gaps
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createPublisher()` connect `app.js` to `home.js`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `run()` (e.g. with `publicChannel()` and `publicJob()`) actually correct?**
  _`run()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `home.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07518796992481203 - nodes in this community are weakly interconnected._
- **Why does `fail()` connect `relay.js` to `youtube-publish.js`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Should `relay.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11458333333333333 - nodes in this community are weakly interconnected._
- **Why does `google-auth-library` connect `package.json` to `home.js`, `youtube-publish.js`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.13368983957219252 - nodes in this community are weakly interconnected._