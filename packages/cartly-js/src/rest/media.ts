import {
  uploadToSession,
  type ArkProgress,
  type ArkUploadSession,
} from "@nerdstackgrp/ark-client"
import { createIdempotencyKey } from "../context"
import type { RestTransport } from "./http"

/**
 * Media upload through REST: Cartly's API opens an ARK upload session, the
 * ARK SDK (`uploadToSession`) moves the bytes straight to ARK (never through
 * Cartly or the app's server), and the API completes it. Works with a
 * browser `File` or any `Blob` (React Native included); the business is the
 * `X-Tenant-Id` the caller passes, checked by the API like every header.
 */

/** Image types the API accepts for a logo (guide §6, "Media upload"). */
export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
] as const

/** Logos: raster images the API accepts as a brand logo (no SVG), at most 5 MB. */
export const LOGO_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const
export const LOGO_MAX_BYTES = 5 * 1024 * 1024

/** API ceiling for images; the plan's own limit may be lower (server decides). */
export const IMAGE_MAX_BYTES = 25 * 1024 * 1024

/** Documents Cartly stores (title deeds, plans, brochures): PDFs, or a picture of the page. */
export const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  ...IMAGE_MIME_TYPES,
] as const
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024

/** Videos for a website: what browsers play, at a size shoppers can still load. */
export const VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024

export interface UploadPreFlightProblem {
  code: "type" | "size" | "empty"
  message: string
}

export function preflightUpload(
  file: { type: string; size: number },
  allowed: readonly string[] = IMAGE_MIME_TYPES,
  maxBytes = IMAGE_MAX_BYTES
): UploadPreFlightProblem | null {
  const video = allowed.includes("video/mp4")
  if (file.size === 0) {
    return {
      code: "empty",
      message: `That file is empty. Pick ${video ? "a video" : "an image"} file.`,
    }
  }
  if (!allowed.includes(file.type)) {
    return {
      code: "type",
      message: video
        ? "Use an MP4, WebM or MOV video."
        : allowed.includes("application/pdf")
          ? "Use a PDF, or a JPEG, PNG, WebP, AVIF or GIF image."
          : "Use a JPEG, PNG, WebP, AVIF or GIF image.",
    }
  }
  if (file.size > maxBytes) {
    return {
      code: "size",
      message: video
        ? `That video is larger than ${String(Math.round(maxBytes / 1024 ** 2))} MB. Use a shorter or smaller one.`
        : "That image is larger than the upload limit.",
    }
  }
  return null
}

/** `POST /media/uploads` → `upload`: ARK's session, presigned URLs only. */
export interface UploadInstruction {
  multipart: boolean
  url: string | null
  method: string
  headers: Record<string, string>
  parts?: Array<{ partNumber: number; url: string }>
  /** Multipart only: ARK's part size, count and suggested parallelism. */
  partSize?: number | null
  partCount?: number | null
  maxConcurrency?: number | null
  expiresAt: string
}

export interface UploadsResponse {
  asset: { id: string; status: string }
  upload: UploadInstruction
}

/**
 * The API's upload instruction as the ARK SDK's session. The ids are only
 * labels here: Cartly completes the upload by its own asset id.
 */
export function toArkSession(
  assetId: string,
  upload: UploadInstruction
): ArkUploadSession {
  if (!upload.multipart) {
    if (!upload.url) throw new Error("The upload could not be started.")
    return {
      uploadId: assetId,
      fileId: assetId,
      multipart: false,
      method: "PUT",
      url: upload.url,
      headers: upload.headers,
      expiresAt: upload.expiresAt,
    }
  }
  const parts = upload.parts ?? []
  if (!upload.partSize || parts.length === 0) {
    throw new Error("The upload could not be started.")
  }
  return {
    uploadId: assetId,
    fileId: assetId,
    multipart: true,
    partSize: upload.partSize,
    partCount: upload.partCount ?? parts.length,
    parts,
    maxConcurrency: upload.maxConcurrency ?? 4,
    expiresAt: upload.expiresAt,
  }
}

export interface UploadMediaResult {
  assetId: string
}

export interface UploadMediaOptions {
  /** The app's REST transport (sessions supply the token; never hardcode). */
  rest: RestTransport
  accessToken: string
  /** The business the asset belongs to (X-Tenant-Id); from the GraphQL client's scope. */
  tenantId?: string | null
  /** A browser File, or any Blob with a type (give `filename` for a Blob). */
  file: Blob & { name?: string }
  filename?: string
  altText?: string
  signal?: AbortSignal
  onProgress?: (progress: ArkProgress) => void
  /** File types and size accepted (default: images). */
  allowed?: readonly string[]
  maxBytes?: number
  /** Where uploads are issued (default: the business's media library). */
  endpoint?: `/${string}`
}

export async function uploadMedia(
  options: UploadMediaOptions
): Promise<UploadMediaResult> {
  const problem = preflightUpload(
    options.file,
    options.allowed,
    options.maxBytes
  )
  if (problem) {
    throw new Error(problem.message)
  }

  // Retrying the same logical upload reuses the key; a new file gets a new one.
  const idempotencyKey = createIdempotencyKey()
  const endpoint: `/${string}` = options.endpoint ?? "/media"

  const issued = await options.rest<UploadsResponse>({
    method: "POST",
    path: `${endpoint}/uploads`,
    body: {
      filename: options.filename || options.file.name || "upload",
      mimeType: options.file.type,
      byteSize: options.file.size,
      altText: options.altText,
    },
    accessToken: options.accessToken,
    headers: {
      "Idempotency-Key": idempotencyKey,
      ...(options.tenantId ? { "X-Tenant-Id": options.tenantId } : {}),
    },
    signal: options.signal,
  })

  const { parts } = await uploadToSession(
    options.file,
    toArkSession(issued.asset.id, issued.upload),
    { signal: options.signal, onProgress: options.onProgress }
  ).catch(() => {
    throw new Error("The upload was refused. Try again in a moment.")
  })

  // `complete` answers with the media item itself, not `{ asset }`.
  const finalized = await options.rest<{ id: string; status: string }>({
    method: "POST",
    path: `${endpoint}/${issued.asset.id}/complete`,
    body: parts ? { parts } : {},
    accessToken: options.accessToken,
    headers: {
      "Idempotency-Key": idempotencyKey,
      ...(options.tenantId ? { "X-Tenant-Id": options.tenantId } : {}),
    },
    signal: options.signal,
  })

  return { assetId: finalized.id }
}
