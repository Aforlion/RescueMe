const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function audit() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_PUBLIC_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing SUPABASE_URL or SUPABASE_ANON_PUBLIC_KEY in .env.local');
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('--- Database Audit ---');

    // Check if we can select from incidents
    const { data, error } = await supabase.from('incidents').select('*').limit(1);

    if (error) {
        console.error('Query Error (expected if table missing or RLS strict):', error.message);
    } else {
        console.log('Successfully queried incidents table.');
        console.log('Data sample:', data);
    }

    // Check storage buckets
    const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
    if (bucketError) {
        console.error('Storage Error:', bucketError.message);
    } else {
        console.log('Storage Buckets:', buckets.map(b => b.name));
    }
}

audit();
