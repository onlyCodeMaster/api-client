// AWS Signature Version 4 (SigV4) request signer.
//
// Implements the algorithm documented at
// https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html
//
// Uses the browser's Web Crypto API (SubtleCrypto) for SHA-256 / HMAC-SHA256
// so we don't need to ship a crypto library. SubtleCrypto is available in
// every Tauri webview backend (WebKitGTK, WKWebView, WebView2).
//
// Limitations:
//   * Form-data bodies are signed with the UNSIGNED-PAYLOAD sentinel because
//     we don't have the multipart-encoded body bytes at signing time (the
//     Rust backend builds them). Most AWS services that you'd hit from an
//     API client (S3, API Gateway, Lambda) accept UNSIGNED-PAYLOAD over HTTPS.
//   * Multi-line header values are not collapsed per RFC; we just trim().
//     Production AWS clients trim and collapse internal whitespace, but real-
//     world requests almost never carry such values.

const ALGORITHM = "AWS4-HMAC-SHA256";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

export interface SigV4Input {
  method: string;
  /** Final URL with query string. */
  url: string;
  /** Lowercased keys are NOT required; we lowercase ourselves. */
  headers: { key: string; value: string }[];
  /** Body bytes the wire will carry. `null` for empty / form-data. */
  body: string | null;
  /** When true (e.g. form-data), payload hash becomes UNSIGNED-PAYLOAD. */
  unsignedPayload?: boolean;

  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  service: string;
}

export interface SigV4Output {
  /** Headers to add to the request. */
  headers: { key: string; value: string }[];
}

/**
 * Sign a request and return the headers to add (Authorization, X-Amz-Date,
 * X-Amz-Content-Sha256, X-Amz-Security-Token).
 */
export async function signSigV4(input: SigV4Input): Promise<SigV4Output> {
  const now = new Date();
  const amzDate = toAmzDateTime(now); // 20231215T091500Z
  const dateStamp = amzDate.slice(0, 8); // 20231215

  const url = new URL(input.url);
  const canonicalUri = canonicalizeUri(url.pathname);
  const canonicalQuery = canonicalizeQuery(url.searchParams);

  // Build the working header set: copy input headers and add the ones SigV4
  // requires us to sign (host, x-amz-date, optional x-amz-security-token,
  // x-amz-content-sha256). These must be in the canonical request AND in
  // SignedHeaders AND in the actual outgoing request.
  const working: Record<string, string> = {};
  for (const h of input.headers) {
    if (!h.key) continue;
    working[h.key.toLowerCase()] = h.value.trim();
  }
  working["host"] = url.host;
  working["x-amz-date"] = amzDate;

  const payloadHash = input.unsignedPayload
    ? UNSIGNED_PAYLOAD
    : await sha256Hex(input.body ?? "");
  working["x-amz-content-sha256"] = payloadHash;

  if (input.sessionToken) {
    working["x-amz-security-token"] = input.sessionToken;
  }

  const sortedHeaderKeys = Object.keys(working).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((k) => `${k}:${working[k]}\n`)
    .join("");
  const signedHeaders = sortedHeaderKeys.join(";");

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await deriveSigningKey(
    input.secretAccessKey,
    dateStamp,
    input.region,
    input.service
  );
  const signature = await hmacHex(signingKey, stringToSign);

  const authorization =
    `${ALGORITHM} ` +
    `Credential=${input.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`;

  const headers: { key: string; value: string }[] = [
    { key: "Authorization", value: authorization },
    { key: "X-Amz-Date", value: amzDate },
    { key: "X-Amz-Content-Sha256", value: payloadHash },
  ];
  if (input.sessionToken) {
    headers.push({ key: "X-Amz-Security-Token", value: input.sessionToken });
  }
  return { headers };
}

// === Canonicalization ===

function canonicalizeUri(path: string): string {
  if (!path) return "/";
  // AWS expects each path segment URI-encoded, '/' kept as separator.
  // S3 is the only service that requires double-encoding, and we don't
  // special-case it — users hitting S3 should put the encoded path in
  // the URL themselves.
  return path
    .split("/")
    .map((seg) => encodeRfc3986(seg))
    .join("/");
}

function canonicalizeQuery(params: URLSearchParams): string {
  const pairs: [string, string][] = [];
  params.forEach((v, k) => pairs.push([k, v]));
  pairs.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  return pairs
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join("&");
}

/**
 * `encodeURIComponent` leaves `!`, `'`, `(`, `)`, `*` unescaped, but RFC 3986
 * (which SigV4 references) considers them reserved. Encode them ourselves so
 * the canonical query matches AWS's expectations.
 */
function encodeRfc3986(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

// === Crypto ===

async function sha256Hex(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(hash));
}

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function hmacHex(key: ArrayBuffer, data: string): Promise<string> {
  const sig = await hmac(key, data);
  return toHex(new Uint8Array(sig));
}

async function deriveSigningKey(
  secret: string,
  date: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kSecret = new TextEncoder().encode(`AWS4${secret}`);
  const kDate = await hmac(kSecret, date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}

function toAmzDateTime(d: Date): string {
  // YYYYMMDDTHHMMSSZ
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}
