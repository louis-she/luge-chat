import { createClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_DB_SCHEMA, SUPABASE_URL } from './config'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: SUPABASE_DB_SCHEMA },
})
