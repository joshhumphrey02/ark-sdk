/**
 * `@nerdstackgrp/ark-server` -- the Ark backend SDK.
 *
 * One package, two ways in (§24):
 *
 * ```ts
 * import { Ark, ArkS3 } from "@nerdstackgrp/ark-server";
 *
 * const ark = new Ark({ token: process.env.ARK_API_TOKEN! });
 * const s3  = new ArkS3({
 *   accessKeyId: process.env.ARK_ACCESS_KEY_ID!,
 *   secretAccessKey: process.env.ARK_SECRET_ACCESS_KEY!,
 * });
 * ```
 *
 * Portions derived from `s3mini` (MIT, (c) 2026 thinking.tools). See
 * LICENSE.upstream.
 */

export { Ark } from "./ark";
export { ArkS3 } from "./s3";
export { ArkError } from "./errors";
export type { ArkErrorCode } from "./errors";
export type {
  ArkBucket,
  ArkFile,
  ArkFolder,
  ArkListedObject,
  ArkMultipartSession,
  ArkObjectMetadata,
  ArkOptions,
  ArkS3Options,
  ArkS3WriteResult,
  ArkStream,
  ArkStreamCreateInput,
  ArkStreamImportInput,
  ArkStreamStatus,
  ArkStreamUploadTicket,
  ArkUsage,
  ArkImageOptions,
  ArkImportInput,
  ArkUploadOptions,
  ArkUploadStream,
  ArkUploadStreamOptions,
  ImageFormat,
  WatermarkPosition,
} from "./types";
