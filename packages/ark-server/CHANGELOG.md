# Changelog

## 1.0.8

### Added

- `ArkStream.hlsExpiresAt` reports when `hlsUrl` and `thumbnailUrl` stop
  working, so a caller can refresh before playback breaks instead of guessing a
  lifetime. Absent on older deployments, where it is `null`.

### Changed

- Documented that `hlsUrl` and `thumbnailUrl` are signed and expire within the
  hour, and must not be stored. `ArkFile.url` is a permanent CDN path, and the
  identical field names made the opposite behaviour easy to miss: storing a
  playback URL yields a link that works in testing and is dead when a user
  opens it. Persist `id` and resolve playback on demand, or use `embedUrl`,
  which carries no credential and does not expire.

### Fixed

- `folders.list()` typed the response as `{ data: ArkFolder[] }`, but
  `GET /api/v2/folders` returns the array under `folders`, so `.data` was
  always `undefined`. This is the same defect reported against the Python SDK,
  and it was present here and in `@nerdstackgrp/ark-client` even though only
  the Python one was reported.

- `folders.list()` now resolves to `ArkFolder[]` rather than the transport
  envelope. The two list endpoints do not agree on one — `/files` sends
  `{data, nextCursor}` and `/folders` sends `{folders, pagination}` — so
  unwrapping here means callers never have to know which arrived. Both keys are
  accepted, and an unrecognised body throws rather than resolving to `[]`.
