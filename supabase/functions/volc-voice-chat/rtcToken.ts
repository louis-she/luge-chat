/**
 * 火山 RTC AccessToken（与官方 Server/token.js 算法一致）
 * @see https://www.volcengine.com/docs/6348/70121
 * @see https://github.com/volcengine/rtc-aigc-demo/blob/main/Server/token.js
 */

const VERSION = '001'
const PRIV_PUBLISH_STREAM = 0
const PRIV_PUBLISH_AUDIO = 1
const PRIV_PUBLISH_VIDEO = 2
const PRIV_PUBLISH_DATA = 3
const PRIV_SUBSCRIBE_STREAM = 4

class ByteBuf {
  private buf = new Uint8Array(1024)
  private pos = 0

  private ensure(n: number) {
    if (this.pos + n <= this.buf.length) return
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.pos + n))
    next.set(this.buf)
    this.buf = next
  }

  pack(): Uint8Array {
    return this.buf.slice(0, this.pos)
  }

  putUint16(v: number): this {
    this.ensure(2)
    this.buf[this.pos++] = v & 0xff
    this.buf[this.pos++] = (v >>> 8) & 0xff
    return this
  }

  putUint32(v: number): this {
    this.ensure(4)
    this.buf[this.pos++] = v & 0xff
    this.buf[this.pos++] = (v >>> 8) & 0xff
    this.buf[this.pos++] = (v >>> 16) & 0xff
    this.buf[this.pos++] = (v >>> 24) & 0xff
    return this
  }

  putBytes(bytes: Uint8Array): this {
    this.putUint16(bytes.length)
    this.ensure(bytes.length)
    this.buf.set(bytes, this.pos)
    this.pos += bytes.length
    return this
  }

  putString(str: string): this {
    return this.putBytes(new TextEncoder().encode(str))
  }

  putTreeMapUInt32(map: Record<number, number>): this {
    const keys = Object.keys(map).map((k) => Number(k))
    this.putUint16(keys.length)
    for (const key of keys) {
      this.putUint16(key)
      this.putUint32(map[key]!)
    }
    return this
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

async function hmacSha256(key: string, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, message))
}

export async function mintRtcAccessToken(opts: {
  appId: string
  appKey: string
  roomId: string
  userId: string
  /** Token 绝对过期时间（unix 秒） */
  expireAt: number
}): Promise<string> {
  const { appId, appKey, roomId, userId, expireAt } = opts
  const issuedAt = Math.floor(Date.now() / 1000)
  const nonce = Math.floor(Math.random() * 0xffffffff)

  const privileges: Record<number, number> = {
    [PRIV_PUBLISH_STREAM]: expireAt,
    [PRIV_PUBLISH_AUDIO]: expireAt,
    [PRIV_PUBLISH_VIDEO]: expireAt,
    [PRIV_PUBLISH_DATA]: expireAt,
    [PRIV_SUBSCRIBE_STREAM]: expireAt,
  }

  const msg = new ByteBuf()
    .putUint32(nonce)
    .putUint32(issuedAt)
    .putUint32(expireAt)
    .putString(roomId)
    .putString(userId)
    .putTreeMapUInt32(privileges)
    .pack()

  const signature = await hmacSha256(appKey, msg)
  const content = new ByteBuf().putBytes(msg).putBytes(signature).pack()
  return VERSION + appId + bytesToBase64(content)
}
