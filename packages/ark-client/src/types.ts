/**
 * Public types for `@nerdstackgrp/ark-client` (§46).
 *
 * These are Ark concepts, deliberately not storage concepts. Nothing here
 * exposes a bucket, a physical key, or which provider holds the bytes -- that
 * is Ark's implementation detail (§1, §50).
 */

export type ArkFile = {
  id: string;
  name: string;
  originalName: string;
  size: number;
  mimeType: string;
  folderId: string | null;
  status: string;
  checksum: string | null;
  /**
   * Permanent, unsigned CDN delivery URL. Safe to store; it does not expire.
   *
   * Always use this value as-is. Do not build a URL from the id, the name, or
   * any other field, and do not append query parameters to reach a variant --
   * `thumbnailUrl` is the thumbnail.
   */
  url: string;
  /** Permanent CDN URL for the generated thumbnail, or null if there is none. */
  thumbnailUrl: string | null;
  /** Permanent CDN URL for the compressed variant, or null if there is none. */
  compressedUrl: string | null;
  createdAt: string | null;
};

export type ArkFolder = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt?: string;
};

export type ArkUsage = {
  storage: {
    usedBytes: number;
    pendingBytes: number;
    limitBytes: number;
    availableBytes: number;
  };
  tier: "free" | "paid";
  status: string;
};

export type ArkProgress = {
  uploadedBytes: number;
  totalBytes: number;
  percentage: number;
};

export type ArkStreamStatus =
  | "created"
  | "uploading"
  | "processing"
  | "ready"
  | "failed";

/** A video managed by Ark Streams. Playback URLs are null until encoding finishes. */
export type ArkStream = {
  id: string;
  title: string;
  status: ArkStreamStatus;
  encodeProgress: number;
  durationSeconds: number;
  width: number;
  height: number;
  size: number;
  /** Poster image. **Signed and short-lived — do not store.** Expires at
   *  `hlsExpiresAt`, like `hlsUrl`. Unlike `ArkFile.thumbnailUrl`, which is a
   *  permanent CDN path, this one stops working. */
  thumbnailUrl: string | null;
  /** HLS manifest. **Signed and short-lived — do not store.** Persist `id`
   *  instead and call `streams.get(id)` when you are about to play; treat this
   *  value like a presigned URL, not like a `ArkFile.url`. */
  hlsUrl: string | null;
  /** When `hlsUrl` and `thumbnailUrl` stop working (ISO-8601), or null when
   *  the library serves unsigned URLs that do not expire. Refresh before this
   *  passes rather than assuming a fixed lifetime. */
  hlsExpiresAt: string | null;
  /** Ark-hosted player page. Drop it straight into an iframe; playback is
   *  signed server-side for each viewer, so the URL carries no credential and
   *  does not expire on its own. **This is the one playback value that is safe
   *  to store.** */
  embedUrl: string | null;
  createdAt: string;
};

export type ArkStreamUploadTicket = { endpoint: string };

export type ArkStreamCreateInput = {
  title: string;
  sizeBytes: number;
  appId?: string;
  collectionId?: string;
};

export type ArkStreamImportInput = {
  title: string;
  url: string;
  appId?: string;
  accessToken?: string;
  sizeBytes?: number;
};

export type ArkStreamUploadOptions = {
  title?: string;
  appId?: string;
  collectionId?: string;
  /** Defaults to 64 MiB. TUS chunks are uploaded sequentially. */
  chunkSize?: number;
  onProgress?: (progress: ArkProgress) => void;
  signal?: AbortSignal;
};

export type ImageFormat = "original" | "jpeg" | "png" | "webp" | "avif";
export type WatermarkPosition = "top-left" | "top-center" | "top-right" | "center-left" | "center" | "center-right" | "bottom-left" | "bottom-center" | "bottom-right";
export type ArkImageOptions = { width?: number; height?: number; quality?: number; format?: ImageFormat; thumbnail?: boolean; watermark?: boolean };

export type ArkUploadOptions = {
  folderId?: string | null;
  /** Overrides the browser-reported type, which is sometimes empty or wrong. */
  contentType?: string;
  metadata?: Record<string, unknown>;
  onProgress?: (progress: ArkProgress) => void;
  signal?: AbortSignal;
};

/** Stable error codes the SDK surfaces (§42). */
export type ArkErrorCode =
  | "INVALID_ARGUMENT"
  | "UNAUTHORIZED"
  | "INSUFFICIENT_SCOPE"
  | "QUOTA_EXCEEDED"
  | "FILE_TOO_LARGE"
  | "INVALID_FILE_TYPE"
  | "UPLOAD_EXPIRED"
  | "UPLOAD_FAILED"
  | "UPLOAD_ABORTED"
  | "NOT_FOUND"
  | "NETWORK_ERROR"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export type ArkClientOptions = {
  /** Ark service origin, e.g. https://ark.nerdstackgrp.com */
  baseUrl?: string;
  /**
   * A short-lived `arkc_…` client session, or an `ark_live_…` token in a
   * trusted server context. Passing a long-lived token from a browser is
   * refused at construction (§15).
   */
  token: string;
  /** API version path segment. Defaults to `v2` (§56). */
  version?: string;
  fetch?: typeof fetch;
};

export type ArkMultipartSession = {
  uploadId: string;
  fileId: string;
  multipart: true;
  partSize: number;
  partCount: number;
  parts: { partNumber: number; url: string }[];
  maxConcurrency: number;
  expiresAt: string;
};

export type ArkSingleUploadSession = {
  uploadId: string;
  fileId: string;
  multipart: false;
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
};

export type ArkUploadSession = ArkMultipartSession | ArkSingleUploadSession;
