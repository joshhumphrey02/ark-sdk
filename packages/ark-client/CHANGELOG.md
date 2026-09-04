# Changelog

## 1.0.6

### Fixed

- `folders.list()` typed the response as `{ data: ArkFolder[] }`, but
  `GET /api/v2/folders` returns the array under `folders`, so `.data` was
  always `undefined`. This is the same defect reported against the Python SDK,
  and it was present here and in `@nerdstackgrp/ark-server` even though only
  the Python one was reported.

- `folders.list()` now resolves to `ArkFolder[]` rather than the transport
  envelope. The two list endpoints do not agree on one — `/files` sends
  `{data, nextCursor}` and `/folders` sends `{folders, pagination}` — so
  unwrapping here means callers never have to know which arrived. Both keys are
  accepted, and an unrecognised body throws rather than resolving to `[]`.
