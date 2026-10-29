/**
 * The Ark addresses a browser reaches, for a Content-Security-Policy:
 * `img-src`/`media-src` for delivery, `connect-src` for uploads and the API.
 * They are Ark's, so applications import them instead of configuring them.
 */

/** Asset delivery: Ark's edge, and storage directly when the edge is bypassed. */
export const ARK_DELIVERY_ORIGINS: readonly string[] = [
  "https://cdn.nerdstackgrp.com",
  "https://ark-store.nerdstackgrp.com",
];

/** Where presigned uploads PUT their bytes (Ark's storage endpoint). */
export const ARK_UPLOAD_ORIGINS: readonly string[] = [
  "https://591ab6cc107246436b8405a80b7ddbd2.r2.cloudflarestorage.com",
];

/** Ark's API, for `ArkClient` calls made from the browser. */
export const ARK_API_ORIGIN = "https://ark.nerdstackgrp.com";
