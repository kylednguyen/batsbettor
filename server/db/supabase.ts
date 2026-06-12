import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null
let initialized = false

export function getSupabase(): SupabaseClient | null {
  if (initialized) return client
  initialized = true

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY

  if (!url || !key) {
    console.warn('Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing) — ingestion disabled')
    return null
  }

  client = createClient(url, key, { auth: { persistSession: false } })
  return client
}

export function isSupabaseConfigured(): boolean {
  return getSupabase() !== null
}
