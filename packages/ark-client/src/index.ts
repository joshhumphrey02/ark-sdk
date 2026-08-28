/**
 * `@nerdstackgrp/ark-client` -- the Ark frontend SDK.
 *
 * ```ts
 * import { ArkClient } from "@nerdstackgrp/ark-client";
 *
 * const ark = new ArkClient({ token: ephemeralArkToken });
 * const file = await ark.files.upload(selectedFile, {
 *   onProgress: ({ percentage }) => setProgress(percentage),
 * });
 * ```
 *
 * Portions derived from `s3-lite-client` (MIT), which itself derives from
 * MinIO's `minio-js` (Apache-2.0). See LICENSE.upstream.
 */

export { ArkClient, type ArkUploadHandle } from "./client";
export { ArkError } from "./errors";
export type {
  ArkClientOptions,
  ArkErrorCode,
  ArkFile,
  ArkFolder,
  ArkMultipartSession,
  ArkProgress,
  ArkSingleUploadSession,
  ArkUploadOptions,
  ArkUploadSession,
  ArkUsage,
  ArkImageOptions,
  ImageFormat,
  WatermarkPosition,
} from "./types";
