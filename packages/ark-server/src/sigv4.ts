/**
 * AWS Signature V4 signing for the Ark S3 client.
 *
 * Adapted from `s3mini` (MIT, (c) 2026 thinking.tools; see LICENSE.upstream).
 * Retained from upstream: the canonical-request construction, the code-point
 * ordering rule, and the daily signing-key derivation. Changed: it uses
 * WebCrypto directly with no Bun-native fast path, so one code path serves
 * Node, Bun, Deno and Workers alike (§47).
 */

const encoder = new TextEncoder();

/**
 * Code-point comparison, as SigV4 requires. `localeCompare` MUST NOT be used:
 * it is locale-aware and case-insensitive by default, so it mis-orders
 * mixed-case parameter names and silently produces invalid signatures.
 */
export function byCodePoint(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(content: string | Uint8Array) {
  const data = typeof content === "string" ? encoder.encode(content) : content;
  return hex(await crypto.subtle.digest("SHA-256", data as BufferSource));
}

async function hmac(key: ArrayBuffer | Uint8Array | string, content: string) {
  const raw = typeof key === "string" ? encoder.encode(key) : key;
  const imported = await crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", imported, encoder.encode(content));
}

/**
 * RFC 3986 encoding. `encodeURIComponent` leaves `!'()*` unescaped, which
 * breaks signatures for keys containing those characters.
 */
export function uriEncode(value: string, encodeSlash = true) {
  let out = "";
  for (const ch of value) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) out += ch;
    else if (ch === "/") out += encodeSlash ? "%2F" : "/";
    else {
      for (const byte of encoder.encode(ch)) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      }
    }
  }
  return out;
}

export function amzDate(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { full: iso, short: iso.slice(0, 8) };
}

export async function signingKey(input: {
  secretAccessKey: string;
  date: string;
  region: string;
  service: string;
}) {
  const kDate = await hmac(`AWS4${input.secretAccessKey}`, input.date);
  const kRegion = await hmac(kDate, input.region);
  const kService = await hmac(kRegion, input.service);
  return hmac(kService, "aws4_request");
}

function canonicalQuery(params: URLSearchParams) {
  const pairs: [string, string][] = [];
  for (const [k, v] of params.entries()) pairs.push([uriEncode(k), uriEncode(v)]);
  pairs.sort((a, b) => byCodePoint(a[0], b[0]) || byCodePoint(a[1], b[1]));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

export async function signRequest(input: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  date?: Date;
}) {
  const service = input.service || "s3";
  const { full, short } = amzDate(input.date);

  const headers: Record<string, string> = {
    ...input.headers,
    host: input.url.host,
    "x-amz-date": full,
    "x-amz-content-sha256": input.payloadHash,
  };

  const signedHeaderNames = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort(byCodePoint);
  const canonicalHeaders = signedHeaderNames
    .map((name) => {
      const value = Object.entries(headers).find(
        ([k]) => k.toLowerCase() === name,
      )?.[1];
      return `${name}:${String(value ?? "").trim().replace(/\s+/g, " ")}`;
    })
    .join("\n");

  const canonicalUri =
    input.url.pathname
      .split("/")
      .map((s) => uriEncode(decodeURIComponent(s)))
      .join("/") || "/";

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri,
    canonicalQuery(input.url.searchParams),
    `${canonicalHeaders}\n`,
    signedHeaderNames.join(";"),
    input.payloadHash,
  ].join("\n");

  const scope = `${short}/${input.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    full,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const key = await signingKey({
    secretAccessKey: input.secretAccessKey,
    date: short,
    region: input.region,
    service,
  });
  const signature = hex(await hmac(key, stringToSign));

  return {
    headers: {
      ...headers,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`,
    },
  };
}

/** Query-signed URL, for handing a time-limited link to another process. */
export async function presignUrl(input: {
  method: string;
  url: URL;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  expiresInSeconds: number;
  service?: string;
  date?: Date;
}) {
  const service = input.service || "s3";
  const { full, short } = amzDate(input.date);
  const scope = `${short}/${input.region}/${service}/aws4_request`;
  const url = new URL(input.url.toString());

  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set("X-Amz-Credential", `${input.accessKeyId}/${scope}`);
  url.searchParams.set("X-Amz-Date", full);
  url.searchParams.set("X-Amz-Expires", String(input.expiresInSeconds));
  url.searchParams.set("X-Amz-SignedHeaders", "host");

  const canonicalRequest = [
    input.method.toUpperCase(),
    url.pathname.split("/").map((s) => uriEncode(decodeURIComponent(s))).join("/") || "/",
    canonicalQuery(url.searchParams),
    `host:${url.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    full,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const key = await signingKey({
    secretAccessKey: input.secretAccessKey,
    date: short,
    region: input.region,
    service,
  });
  url.searchParams.set("X-Amz-Signature", hex(await hmac(key, stringToSign)));
  return url.toString();
}
