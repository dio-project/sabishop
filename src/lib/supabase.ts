import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || 'https://qatkotmliqxrzoltkmfu.supabase.co'
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_4sT0dfXoMHYiKKnlyufsIQ_gm5g22K_'

// Publishable keys are intended for browser use. Row-level security is the actual
// access boundary; never place a Supabase secret/service-role key here.
export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null
