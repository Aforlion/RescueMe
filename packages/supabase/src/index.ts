import { createClient } from '@supabase/supabase-js';

/**
 * Shared Supabase client initialization.
 * 
 * For Web: Uses process.env.NEXT_PUBLIC_SUPABASE_URL
 * For Mobile: Uses specific configuration or direct env access
 */
export const getSupabaseClient = (supabaseUrl: string, supabaseAnonKey: string) => {
    if (!supabaseUrl || !supabaseAnonKey) {
        console.warn('Supabase credentials missing. Client initialized with empty strings.');
    }
    return createClient(supabaseUrl, supabaseAnonKey);
};

// Default singleton for web (next.js)
export const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);
