import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_KEY)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL!, SUPABASE_KEY!)
  : null

export type HealingStatus = 'detecting' | 'parsing' | 'patching' | 'deploying' | 'success' | 'failed'

export interface ErrorLogRow {
  id:              string
  created_at:      string
  error_type:      string
  raw_log:         Record<string, unknown>
  status:          HealingStatus
  patch_code_diff: string | null
  healing_log:     string[]
  session_id:      string | null
  resolved_at:     string | null
}
