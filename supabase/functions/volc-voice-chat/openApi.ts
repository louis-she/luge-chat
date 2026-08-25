/**
 * 火山引擎 OpenAPI V4 签名（与 @volcengine/openapi Signer 对齐）
 * 用于 rtc.volcengineapi.com StartVoiceChat / StopVoiceChat
 */

const ALGORITHM = 'HMAC-SHA256'
const V4_IDENTIFIER = 'request'
const UNSIGNABLE = new Set([
  'authorization',
  'content-type',
  'content-length',
  'user-agent',
  'presigned-expires',
  'expect',
])

function toHex(buf: Uint8Array): string {
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : data
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return toHex(new Uint8Array(hash))
}

async function hmac(
  key: Uint8Array | string,
  message: string | Uint8Array,
): Promise<Uint8Array> {
  const keyBytes =
    typeof key === 'string' ? new TextEncoder().encode(key) : key
  const msgBytes =
    typeof message === 'string' ? new TextEncoder().encode(message) : message
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, msgBytes))
}

function uriEscape(str: string): string {
  return encodeURIComponent(str)
    .replace(/[^A-Za-z0-9_.~\-%]+/g, (ch) =>
      [...ch]
        .map((c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
        .join(''),
    )
    .replace(/\*/g, '%2A')
}

function queryParamsToString(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .sort()
    .map((k) => `${uriEscape(k)}=${uriEscape(params[k]!)}`)
    .join('&')
}

function iso8601Compact(date = new Date()): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[:\-]|\.\d{3}/g, '')
}

function canonicalHeaderValues(v: string): string {
  return v.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '')
}

export async function signVolcOpenApiRequest(opts: {
  accessKeyId: string
  secretKey: string
  region?: string
  service?: string
  method?: string
  host: string
  path?: string
  query: Record<string, string>
  body: unknown
}): Promise<{ url: string; headers: Record<string, string>; bodyText: string }> {
  const region = opts.region ?? 'cn-north-1'
  const service = opts.service ?? 'rtc'
  const method = (opts.method ?? 'POST').toUpperCase()
  const path = opts.path ?? '/'
  const host = opts.host
  const bodyText = JSON.stringify(opts.body)
  const datetime = iso8601Compact()
  const date = datetime.slice(0, 8)

  const headers: Record<string, string> = {
    Host: host,
    'Content-Type': 'application/json',
    'X-Date': datetime,
    'X-Content-Sha256': await sha256Hex(bodyText),
  }

  const signedHeaderKeys = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .filter((k) => !UNSIGNABLE.has(k))
    .sort()

  const canonicalHeaders =
    signedHeaderKeys
      .map((k) => {
        const orig = Object.keys(headers).find((h) => h.toLowerCase() === k)!
        return `${k}:${canonicalHeaderValues(headers[orig]!)}`
      })
      .join('\n') + '\n'

  const canonicalRequest = [
    method,
    path,
    queryParamsToString(opts.query),
    canonicalHeaders,
    signedHeaderKeys.join(';'),
    headers['X-Content-Sha256'],
  ].join('\n')

  const credentialScope = `${date}/${region}/${service}/${V4_IDENTIFIER}`
  const stringToSign = [
    ALGORITHM,
    datetime,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

  const kDate = await hmac(opts.secretKey, date)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, service)
  const kSigning = await hmac(kService, V4_IDENTIFIER)
  const signature = toHex(await hmac(kSigning, stringToSign))

  headers.Authorization = [
    `${ALGORITHM} Credential=${opts.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaderKeys.join(';')}`,
    `Signature=${signature}`,
  ].join(', ')

  const qs = queryParamsToString(opts.query)
  return {
    url: `https://${host}${path}?${qs}`,
    headers,
    bodyText,
  }
}

export async function callRtcOpenApi<T = unknown>(opts: {
  accessKeyId: string
  secretKey: string
  action: string
  version: string
  body: unknown
}): Promise<{ ok: boolean; status: number; data: T }> {
  const signed = await signVolcOpenApiRequest({
    accessKeyId: opts.accessKeyId,
    secretKey: opts.secretKey,
    host: 'rtc.volcengineapi.com',
    query: {
      Action: opts.action,
      Version: opts.version,
    },
    body: opts.body,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(signed.url, {
      method: 'POST',
      headers: signed.headers,
      body: signed.bodyText,
      signal: controller.signal,
    })
    const data = (await res.json().catch(() => ({}))) as T
    return { ok: res.ok, status: res.status, data }
  } finally {
    clearTimeout(timer)
  }
}
