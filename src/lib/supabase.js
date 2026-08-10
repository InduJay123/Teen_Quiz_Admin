import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const demoMode = String(import.meta.env.VITE_DEMO_MODE || '').toLowerCase() === 'true'

if (!demoMode && (!url || !key || key.includes('PASTE_YOUR'))) {
  console.warn('Teen Quiz Admin: Supabase environment variables are not configured.')
}

export const supabase = demoMode || !url || !key
  ? null
  : createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
