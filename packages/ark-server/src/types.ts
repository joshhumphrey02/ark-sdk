/** Public types for `@nerdstackgrp/ark-server` (§46). */

export type ArkFile = {
  id: string;
  name: string;
  originalName: string;
  size: number;
  mimeType: string;
  folderId: string | null;
  status: string;
  checksum: string | null;
  url: string;
  createdAt: string | null;
};

export type ArkFolder = {
  id: string;
  name: string;
  parentId: string | null;
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

export type ImageFormat = "original" | "jpeg" | "png" | "webp" | "avif";
export type WatermarkPosition = "top-left" | "top-center" | "top-right" | "center-left" | "center" | "center-right" | "bottom-left" | "bottom-center" | "bottom-right";
export type ArkImageOptions = { width?: number; height?: number; quality?: number; format?: ImageFormat; thumbnail?: boolean; watermark?: boolean };
export type ArkImportInput = { appId: string; sourceType: "s3" | "r2" | "bunny" | "minio" | "s3_compatible" | "url"; endpoint?: string; region?: string; bucket?: string; prefix?: string; url?: string; accessKey?: string; secretKey?: string; conflictStrategy?: "skip" | "rename" | "overwrite" };

/** A one-shot byte stream accepted by the server-side upload helper. */
export type ArkUploadStream =
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array>;

export type ArkUploadOptions = {
  filename?: string;
  contentType?: string;
  folderId?: string | null;
  metadata?: Record<string, unknown>;
};

export type ArkUploadStreamOptions = Omit<ArkUploadOptions, "filename"> & {
  /** Exact byte length, required for quota reservation and multipart planning. */
  size: number;
  filename: string;
};

export type ArkBucket = {
  name: string;
  createdAt: string;
};

export type ArkObjectMetadata = {
  size: number;
  contentType: string | null;
  etag: string | null;
  lastModified: Date | null;
};

/** Canonical identity Ark returns after an S3 write has been committed. */
export type ArkS3WriteResult = {
  etag: string;
  /** Stable delivery URL. Null when talking to an older Ark gateway. */
  url: string | null;
  assetId: string | null;
  /** Ark's physical object key, distinct from the caller's logical S3 key. */
  objectKey: string | null;
};

export type ArkListedObject = {
  key: string;
  size: number;
  etag: string | null;
  lastModified: Date | null;
};

export type ArkMultipartSession = {
  uploadId: string;
  bucket: string;
  key: string;
};

export type ArkOptions = {
  token: string;
  /** Ark service origin, e.g. https://ark.nerdstackgrp.com. */
  baseUrl?: string;
  version?: string;
  fetch?: typeof fetch;
};

export type ArkS3Options = {
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket?: string;
  region?: string;
  fetch?: typeof fetch;
};
