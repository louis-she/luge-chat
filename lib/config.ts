/** Supabase API gateway */
export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://api.luge.chat'

/** Anon / publishable key. 须在 `.env.local` 中配置。 */
export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  ''

/**
 * PostgREST schema profile.
 * - Dev client (`__DEV__`) → `dev`
 * - Release build → `public`
 */
export const SUPABASE_DB_SCHEMA =
  process.env.EXPO_PUBLIC_SUPABASE_DB_SCHEMA ?? (__DEV__ ? 'dev' : 'public')

export const WECHAT_APP_ID =
  process.env.EXPO_PUBLIC_WECHAT_APP_ID ?? 'wx670d93537c72d57a'

/** iOS 微信 Universal Link，须与微信开放平台及 apple-app-site-association 一致 */
export const WECHAT_UNIVERSAL_LINK =
  process.env.EXPO_PUBLIC_WECHAT_UNIVERSAL_LINK ?? 'https://luge.chat/app/'

export const SESSION_STORAGE_KEY = 'lugechat.session'
