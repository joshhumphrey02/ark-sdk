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
  url: string;
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
  /** Ark API base URL, e.g. https://ark.nerdstackgrp.com/api */
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
