const { createClient } = require('@supabase/supabase-js');

async function setup() {
    const supabaseUrl = "https://pveilpyiwggkepbnahqe.supabase.co";
    const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2ZWlscHlpd2dna2VwYm5haHFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzMjg5OSwiZXhwIjoyMDg3NjA4ODk5fQ.qZlpbgk3CdT-G0Zt_w2b790QizccTT3nJozpMc4DBkI";

    const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });

    const testPhones = ["+2348066379980", "+2348034753055"];
    const guideIds = [];

    console.log("--- Setting up Test Guides ---");

    for (const phone of testPhones) {
        console.log(`Processing ${phone}...`);

        // 1. Create or get user in auth.users
        const { data: user, error: authError } = await supabase.auth.admin.createUser({
            phone,
            password: "password123", // Dummy
            phone_confirm: true
        });

        if (authError) {
            if (authError.message.includes("already registered")) {
                console.log(`User ${phone} already exists in auth. Fetching ID...`);
                // We'll need to fetch the user ID if it already exists
                // But since profiles were empty, this is unlikely.
            } else {
                console.error(`Auth Error for ${phone}:`, authError.message);
                continue;
            }
        }

        const userId = user?.user?.id;
        if (!userId) {
            // If already exists, search for it
            const { data: users, error: listError } = await supabase.auth.admin.listUsers();
            const existingUser = users?.users?.find(u => u.phone === phone.replace("+", ""));
            if (existingUser) {
                guideIds.push(existingUser.id);
                console.log(`Found existing user ID: ${existingUser.id}`);
            }
            continue;
        }

        guideIds.push(userId);
        console.log(`Created user ID: ${userId}`);

        // 2. Upsert profile as GUIDE
        const { error: profileError } = await supabase
            .from('profiles')
            .upsert({
                id: userId,
                full_name: `Test Guide (${phone.slice(-4)})`,
                role: 'GUIDE',
                phone: phone,
                trust_score: 85,
                location: `POINT(7.3986 9.0765)` // Abuja center
            });

        if (profileError) {
            console.error(`Profile Error for ${phone}:`, profileError.message);
        } else {
            console.log(`Profile for ${phone} updated as GUIDE.`);
        }
    }

    if (guideIds.length === 0) {
        console.error("No guide IDs found. Stopping.");
        return;
    }

    // 3. Create a test incident
    console.log("\n--- Creating Test Incident ---");
    const { data: incident, error: incidentError } = await supabase
        .from('incidents')
        .insert({
            type: 'MEDICAL',
            status: 'ASSIGNED',
            description: 'LIVE TEST: Please accept to verify USSD flow.',
            latitude: 9.0765,
            longitude: 7.3986,
            location: `POINT(7.3986 9.0765)`,
            assigned_guide_ids: guideIds,
            sla_deadline: new Date(Date.now() + 120000).toISOString() // 2 mins
        })
        .select()
        .single();

    if (incidentError) {
        console.error("Incident Error:", incidentError.message);
    } else {
        console.log(`Test Incident Created: ${incident.id}`);
        console.log(`Assigned to: ${guideIds.join(", ")}`);
    }
}

setup();
