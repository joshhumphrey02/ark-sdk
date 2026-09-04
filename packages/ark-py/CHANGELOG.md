# Changelog

## 1.0.5

### Added

- `ArkStream.hls_expires_at` reports when `hls_url` and `thumbnail_url` stop
  working, so a caller can refresh before playback breaks instead of guessing a
  lifetime. Absent on older deployments, where it parses as `None`.

### Changed

- Documented that `hls_url` and `thumbnail_url` are signed and expire within
  the hour, and must not be stored. `ArkFile.url` is a permanent CDN path, and
  the identical field names made the opposite behaviour easy to miss: storing a
  playback URL yields a link that works in testing and is dead when a user
  opens it. Persist `id` and resolve playback on demand, or use `embed_url`,
  which carries no credential and does not expire.

### Fixed

- `folders.list()` and `AsyncFolders.list()` returned an empty tuple against
  every real workspace. `GET /api/v2/folders` returns the array under
  `folders`, but the SDK read `data` — the key `/api/v2/files` uses. The
  missing key was silently coerced to an empty list, so callers that resolve a
  folder by name saw "no such folder", called `create()`, and got back
  "A folder with this name already exists here". Nesting was unusable for the
  same reason, since resolving `a/b/c` lists children at each level.

  Both envelopes are now accepted, so an older deployment keeps working.

- A folder-list body the SDK cannot parse now raises `ArkError` with code
  `INVALID_RESPONSE` instead of being reported as an empty list. The silent
  empty result is what made the bug above expensive to diagnose: `list()` and
  `create()` reported opposite things and neither raised.

- `ArkError` now exposes `message`. It was documented and passed to
  `Exception.__init__`, but never stored, so `error.message` raised
  `AttributeError` inside callers' own error handlers. `str(error)` was the
  only thing that worked.

- `ark_py.__version__` read `1.0.0` while the package was on 1.0.4. It is now
  read from the installed distribution metadata, so it cannot drift again.

### Internal

- Folder parsing moved to `_shared.parse_folder_list`. The identical code was
  duplicated in the sync and async clients, which is why one bug needed fixing
  in two places, and why the async client had no folder test at all.
