/**
 * `ArkS3` -- S3-compatible client for the Ark S3 gateway (§23).
 *
 * Signs with Ark-issued credentials against Ark's own endpoint. These are not
 * Bunny or R2 credentials, and the caller never learns which provider actually
 * holds the bytes (§1, §4).
 *
 * The signing implementation is adapted from `s3mini` (MIT); see
 * LICENSE.upstream.
 */

import { ArkError, errorFromS3Xml } from "./errors";
import { presignUrl, sha256Hex, signRequest } from "./sigv4";
import type {
  ArkListedObject,
  ArkObjectMetadata,
  ArkS3Options,
  ArkBucket,
} from "./types";

const DEFAULT_ENDPOINT = "https://ark.nerdstackgrp.com/s3";

/**
 * Ark's gateway is region-agnostic, but SigV4 requires *some* region in the
 * credential scope, and it must match what the server expects. `auto` mirrors
 * what R2 uses and what the AWS SDK sends when configured for Ark.
 */
const DEFAULT_REGION = "auto";

export class ArkS3 {
  readonly #endpoint: string;
  readonly #accessKeyId: string;
  readonly #secretAccessKey: string;
  readonly #region: string;
  readonly #bucket: string | null;
  readonly #fetch: typeof fetch;

  constructor(options: ArkS3Options) {
    if (!options?.accessKeyId || !options?.secretAccessKey) {
      throw new ArkError({
        code: "UNAUTHORIZED",
        message: "Ark S3 credentials are required (accessKeyId and secretAccessKey)",
      });
    }
    this.#endpoint = (options.endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, "");
    this.#accessKeyId = options.accessKeyId;
    this.#secretAccessKey = options.secretAccessKey;
    this.#region = options.region || DEFAULT_REGION;
    this.#bucket = options.bucket ?? null;
    this.#fetch = options.fetch || globalThis.fetch.bind(globalThis);
  }

  #resolveBucket(bucket?: string) {
    const name = bucket || this.#bucket;
    if (!name) {
      throw new ArkError({
        code: "NO_SUCH_BUCKET",
        message: "A bucket must be supplied, either per call or via the constructor",
      });
    }
    return name;
  }

  /** Path-style addressing, which is what the gateway serves. */
  #url(bucket: string | null, key?: string, query?: Record<string, string>) {
    const path = bucket
      ? key
        ? `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`
        : `/${bucket}`
      : "/";
    const url = new URL(`${this.#endpoint}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    return url;
  }

  async #send(input: {
    method: string;
    url: URL;
    body?: Uint8Array | string;
    headers?: Record<string, string>;
    expectedStatus?: number[];
  }) {
    // Bodies are hashed so the gateway can verify a signed payload; unsigned
    // is only used where the body is a stream of unknown length.
    const payloadHash = input.body
      ? await sha256Hex(
          typeof input.body === "string" ? input.body : input.body,
        )
      : await sha256Hex("");

    const signed = await signRequest({
      method: input.method,
      url: input.url,
      headers: input.headers ?? {},
      payloadHash,
      accessKeyId: this.#accessKeyId,
      secretAccessKey: this.#secretAccessKey,
      region: this.#region,
    });

    let response: Response;
    try {
      response = await this.#fetch(input.url.toString(), {
        method: input.method,
        headers: signed.headers,
        body: input.body as BodyInit | undefined,
        // The gateway answers GET with a redirect to a short-lived provider
        // URL; following it is what avoids proxying bytes through Ark (§26).
        redirect: "follow",
      });
    } catch (error) {
      throw new ArkError({
        code: "NETWORK_ERROR",
        message: (error as Error)?.message || "Network request failed",
      });
    }

    const expected = input.expectedStatus ?? [200, 204];
    if (!expected.includes(response.status)) {
      const text = await response.text().catch(() => "");
      throw errorFromS3Xml(text, response.status);
    }
    return response;
  }

  async putObject(
    key: string,
    body: Uint8Array | string,
    options: { bucket?: string; contentType?: string } = {},
  ) {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    const response = await this.#send({
      method: "PUT",
      url: this.#url(this.#resolveBucket(options.bucket), key),
      body: bytes,
      headers: {
        "content-type": options.contentType || "application/octet-stream",
        "content-length": String(bytes.length),
      },
      expectedStatus: [200],
    });
    return { etag: (response.headers.get("etag") || "").replace(/"/g, "") };
  }

  async getObject(key: string, options: { bucket?: string } = {}) {
    const response = await this.#send({
      method: "GET",
      url: this.#url(this.#resolveBucket(options.bucket), key),
      expectedStatus: [200, 206],
    });
    return new Uint8Array(await response.arrayBuffer());
  }

  async headObject(
    key: string,
    options: { bucket?: string } = {},
  ): Promise<ArkObjectMetadata> {
    const response = await this.#send({
      method: "HEAD",
      url: this.#url(this.#resolveBucket(options.bucket), key),
      expectedStatus: [200],
    });
    const lastModified = response.headers.get("last-modified");
    return {
      size: Number(response.headers.get("content-length") || 0),
      contentType: response.headers.get("content-type"),
      etag: (response.headers.get("etag") || "").replace(/"/g, "") || null,
      lastModified: lastModified ? new Date(lastModified) : null,
    };
  }

  async deleteObject(key: string, options: { bucket?: string } = {}) {
    await this.#send({
      method: "DELETE",
      url: this.#url(this.#resolveBucket(options.bucket), key),
      expectedStatus: [204, 200],
    });
    return { deleted: true };
  }

  async listObjects(
    options: {
      bucket?: string;
      prefix?: string;
      delimiter?: string;
      maxKeys?: number;
      continuationToken?: string;
    } = {},
  ): Promise<{
    objects: ArkListedObject[];
    prefixes: string[];
    isTruncated: boolean;
    nextContinuationToken: string | null;
  }> {
    const query: Record<string, string> = { "list-type": "2" };
    if (options.prefix) query.prefix = options.prefix;
    if (options.delimiter) query.delimiter = options.delimiter;
    if (options.maxKeys) query["max-keys"] = String(options.maxKeys);
    if (options.continuationToken) query["continuation-token"] = options.continuationToken;

    const response = await this.#send({
      method: "GET",
      url: this.#url(this.#resolveBucket(options.bucket), undefined, query),
      expectedStatus: [200],
    });
    const xml = await response.text();
    return parseListResult(xml);
  }

  async listBuckets(): Promise<ArkBucket[]> {
    const response = await this.#send({
      method: "GET",
      url: this.#url(null),
      expectedStatus: [200],
    });
    const xml = await response.text();
    const buckets: ArkBucket[] = [];
    const pattern = /<Bucket>[\s\S]*?<Name>([^<]+)<\/Name>[\s\S]*?<CreationDate>([^<]+)<\/CreationDate>[\s\S]*?<\/Bucket>/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(xml)) !== null) {
      buckets.push({ name: match[1]!, createdAt: match[2]! });
    }
    return buckets;
  }

  async createBucket(name: string) {
    await this.#send({
      method: "PUT",
      url: this.#url(name),
      expectedStatus: [200],
    });
    return { name };
  }

  // ── Multipart (§27) ───────────────────────────────────────────────────────

  async createMultipartUpload(
    key: string,
    options: { bucket?: string; contentType?: string } = {},
  ) {
    const response = await this.#send({
      method: "POST",
      url: this.#url(this.#resolveBucket(options.bucket), key, { uploads: "" }),
      headers: { "content-type": options.contentType || "application/octet-stream" },
      expectedStatus: [200],
    });
    const xml = await response.text();
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1];
    if (!uploadId) {
      throw new ArkError({ code: "INTERNAL_ERROR", message: "No upload id returned" });
    }
    return { uploadId };
  }

  async uploadPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    body: Uint8Array;
    bucket?: string;
  }) {
    const response = await this.#send({
      method: "PUT",
      url: this.#url(this.#resolveBucket(input.bucket), input.key, {
        uploadId: input.uploadId,
        partNumber: String(input.partNumber),
      }),
      body: input.body,
      headers: { "content-length": String(input.body.length) },
      expectedStatus: [200],
    });
    return {
      partNumber: input.partNumber,
      etag: (response.headers.get("etag") || "").replace(/"/g, ""),
    };
  }

  async completeMultipartUpload(input: {
    key: string;
    uploadId: string;
    parts: { partNumber: number; etag: string }[];
    bucket?: string;
  }) {
    const body =
      `<CompleteMultipartUpload>` +
      input.parts
        .slice()
        .sort((a, b) => a.partNumber - b.partNumber)
        .map(
          (p) =>
            `<Part><PartNumber>${p.partNumber}</PartNumber>` +
            `<ETag>"${p.etag.replace(/"/g, "")}"</ETag></Part>`,
        )
        .join("") +
      `</CompleteMultipartUpload>`;

    const response = await this.#send({
      method: "POST",
      url: this.#url(this.#resolveBucket(input.bucket), input.key, {
        uploadId: input.uploadId,
      }),
      body,
      headers: { "content-type": "application/xml" },
      expectedStatus: [200],
    });
    const xml = await response.text();
    return { etag: (/<ETag>"?([^"<]+)"?<\/ETag>/.exec(xml)?.[1] ?? "").trim() };
  }

  async abortMultipartUpload(input: { key: string; uploadId: string; bucket?: string }) {
    await this.#send({
      method: "DELETE",
      url: this.#url(this.#resolveBucket(input.bucket), input.key, {
        uploadId: input.uploadId,
      }),
      expectedStatus: [204, 200],
    });
    return { aborted: true };
  }

  // ── Presigning (§27) ──────────────────────────────────────────────────────

  presignGet(key: string, options: { bucket?: string; expiresInSeconds?: number } = {}) {
    return presignUrl({
      method: "GET",
      url: this.#url(this.#resolveBucket(options.bucket), key),
      accessKeyId: this.#accessKeyId,
      secretAccessKey: this.#secretAccessKey,
      region: this.#region,
      expiresInSeconds: options.expiresInSeconds ?? 900,
    });
  }

  presignPut(key: string, options: { bucket?: string; expiresInSeconds?: number } = {}) {
    return presignUrl({
      method: "PUT",
      url: this.#url(this.#resolveBucket(options.bucket), key),
      accessKeyId: this.#accessKeyId,
      secretAccessKey: this.#secretAccessKey,
      region: this.#region,
      expiresInSeconds: options.expiresInSeconds ?? 900,
    });
  }
}

function parseListResult(xml: string) {
  const objects: ArkListedObject[] = [];
  const pattern =
    /<Contents>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<LastModified>([^<]*)<\/LastModified>[\s\S]*?<ETag>"?([^"<]*)"?<\/ETag>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    objects.push({
      key: match[1]!,
      lastModified: match[2] ? new Date(match[2]) : null,
      etag: match[3] || null,
      size: Number(match[4]),
    });
  }

  const prefixes: string[] = [];
  const prefixPattern = /<CommonPrefixes><Prefix>([^<]+)<\/Prefix><\/CommonPrefixes>/g;
  while ((match = prefixPattern.exec(xml)) !== null) prefixes.push(match[1]!);

  return {
    objects,
    prefixes,
    isTruncated: /<IsTruncated>true<\/IsTruncated>/.test(xml),
    nextContinuationToken:
      /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null,
  };
}
