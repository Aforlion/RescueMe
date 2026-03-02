// @ts-types="jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2";
import { notifyGuide } from "../_shared/smsClient.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AT_API_KEY = Deno.env.get("AT_API_KEY") ?? "";

// Reply code → action mapping
const REPLY_ACTIONS: Record<string, string> = {
    "1": "ACCEPTED",
    "2": "REJECTED",
    "3": "BACKUP_REQUESTED",
    "4": "ON_SCENE",
};

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
    // DEBUG: Log headers to see what AT is sending
    console.log("Inbound Headers:", JSON.stringify(Object.fromEntries(req.headers.entries())));

    // NOTE: Africa's Talking does NOT send your API Key in the callback header.
    // For production security, we recommend using a private URL or checking AT IP ranges.
    // Removing strict mismatch check for the live test.


    const body = await req.formData();
    const rawPhone = body.get("phoneNumber")?.toString() ?? "";
    const text = body.get("text")?.toString().trim() ?? "";
    const isUssd = body.has("serviceCode");

    console.log("Inbound Payload:", JSON.stringify(Object.fromEntries(body.entries())));

    if (!rawPhone) {
        return ussdResponse("END Invalid request. Missing phone number.");
    }

    // Africa's Talking strips '+' in some configs — normalise to E.164
    const phoneNumber = rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false },
    });

    // --- Step 1: Look up guide by phone number ---
    // PRIVACY: phone is used only for lookup — never written to audit logs
    const { data: guide } = await admin
        .from("profiles")
        .select("id, full_name, token_balance, trust_score, skill_tier")
        .eq("phone", phoneNumber)
        .eq("role", "GUIDE")
        .maybeSingle();

    if (!guide) {
        return ussdResponse("END Phone number not registered as a RescueMe Guide.");
    }

    const guideData = guide as {
        id: string;
        full_name: string;
        token_balance: number;
        trust_score: number;
        skill_tier: string;
    };
    const guideId = guideData.id;
    const guideName = guideData.full_name;

    console.log(`[USSD] Guide found: ${guideName} (${guideId}) for phone ${phoneNumber}`);

    // --- Step 2: Find their currently assigned incident ---
    const { data: incident, error: lookupError } = await admin
        .from("incidents")
        .select("id, type, latitude, longitude, status")
        .contains("assigned_guide_ids", [guideId])
        .in("status", ["ASSIGNED", "ACCEPTED"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (lookupError) {
        console.error(`[USSD] Incident lookup error for guide ${guideId}:`, lookupError.message);
    }

    // --- NEW: Main Menu Fallback if No Incident ---
    if (!incident) {
        if (!text) {
            return ussdResponse(
                `CON RescueMe Abuja — Welcome ${guideName}\n` +
                `1. Report Emergency\n` +
                `2. Check Token Balance\n` +
                `3. View My Trust Score`
            );
        }

        if (text === "1") {
            return ussdResponse("END To report an emergency, dial *384*5# or call the control room immediately.");
        }
        if (text === "2") {
            return ussdResponse(`END Your current balance: ₦${guideData.token_balance.toLocaleString()}\nThank you for serving Abuja.`);
        }
        if (text === "3") {
            return ussdResponse(`END Trust Score: ${guideData.trust_score}/100\nRank: ${guideData.skill_tier}\nComplete rescues to level up.`);
        }

        return ussdResponse("END Invalid option. Please dial *384*00705# to start again.");
    }

    const incidentRecord = incident as {
        id: string; type: string; latitude: number; longitude: number; status: string;
    };
    const shortRef = incidentRecord.id.slice(-4).toUpperCase();

    // --- Step 3: Handle USSD menu vs direct SMS reply ---
    const action = REPLY_ACTIONS[text];

    if (!action) {
        if (isUssd) {
            return ussdResponse(
                `CON RescueMe — Active: ${incidentRecord.type} [${shortRef}]\n` +
                `1. Accept assignment\n` +
                `2. Reject assignment\n` +
                `3. Request backup\n` +
                `4. Mark as On-Scene`
            );
        }
        return ussdResponse("END Unrecognised code. Reply 1=Accept, 2=Reject, 3=Backup.");
    }

    // --- Step 4: Log audit event
    // PRIVACY: metadata carries only { channel } — no phone/name/session_id stored
    await admin.from("incident_logs").insert({
        incident_id: incidentRecord.id,
        event_type: action,
        actor_id: guideId,
        metadata: { channel: isUssd ? "USSD" : "SMS" },
    });

    // --- Step 5: Handle each action ---
    if (action === "ACCEPTED") {
        // [ATOMIC ACCEPTANCE FIX]: Only update if no one else has accepted yet
        const { error: acceptError, count } = await admin.from("incidents").update({
            status: "ACCEPTED",   // enum patch: ensure status is updated accordingly
            accepted_by: guideId,
        })
            .eq("id", incidentRecord.id)
            .is("accepted_by", null)
            .select("*", { count: "exact" });

        if (acceptError || count === 0) {
            return ussdResponse("END Incident already accepted by another responder. Stand down.");
        }

        await notifyGuide(admin, {
            phone: phoneNumber,
            guideId,
            incidentId: incidentRecord.id,
            message:
                `[RESCUEME] ${guideName}, you accepted incident ${shortRef}.\n` +
                `Location: ${incidentRecord.latitude.toFixed(4)}N, ${incidentRecord.longitude.toFixed(4)}E\n` +
                `Trust+5 on completion. Stay safe.`,
        });

        return ussdResponse(
            `END Assignment accepted.\nNavigate to ${incidentRecord.latitude.toFixed(4)}N, ` +
            `${incidentRecord.longitude.toFixed(4)}E.\nStay safe. Command is monitoring.`
        );
    }

    if (action === "REJECTED") {
        // [REJECTION CLEANUP FIX]: Remove from assigned list to prevent SLA penalty
        // Logic: Use RPC or raw SQL patch to array_remove guideId from assigned_guide_ids
        await admin.rpc("remove_guide_from_incident", {
            p_incident_id: incidentRecord.id,
            p_guide_id: guideId
        });

        await notifyGuide(admin, {
            phone: phoneNumber,
            guideId,
            incidentId: incidentRecord.id,
            message: `[RESCUEME] Rejection logged for incident ${shortRef}. Another guide will be assigned.`,
        });
        return ussdResponse(`END Rejection recorded for ${shortRef}. Another guide will be dispatched.`);
    }

    if (action === "ON_SCENE") {
        // [ON-SCENE FIX]: Mark as on-scene to stop the clock
        await admin.from("incidents").update({
            status: "ON_SCENE",
        }).eq("id", incidentRecord.id);

        await logEvent(admin, incidentRecord.id, "ON_SCENE", guideId);

        return ussdResponse(`END Stay safe, ${guideName}. Help is here. Command is on the line.`);
    }

    if (action === "BACKUP_REQUESTED") {
        await admin.from("incidents").update({ status: "ESCALATED" }).eq("id", incidentRecord.id);
        await notifyGuide(admin, {
            phone: phoneNumber,
            guideId,
            incidentId: incidentRecord.id,
            message: `[RESCUEME] Backup requested for ${shortRef}. Admin Control has been notified.`,
        });
        return ussdResponse(`END Backup requested. Admin Control has been notified for incident ${shortRef}.`);
    }

    return ussdResponse("END Action recorded.");
});

// ---------------------------------------------------------------------------
// Helper: format a USSD/SMS plain-text response
// ---------------------------------------------------------------------------
function ussdResponse(text: string): Response {
    // AT USSD Protocol: Must start with "CON " or "END "
    const responseString = text.startsWith("CON ") || text.startsWith("END ")
        ? text
        : `END ${text}`;

    console.log("AT Response Sent:", responseString);

    return new Response(responseString, {
        headers: { "Content-Type": "text/plain" },
        status: 200,
    });
}

// ---------------------------------------------------------------------------
// Helper: log event (matching process_incident_assignment logic)
// ---------------------------------------------------------------------------
async function logEvent(
    admin: any,
    incidentId: string,
    eventType: string,
    actorId: string
): Promise<void> {
    await admin.from("incident_logs").insert({
        incident_id: incidentId,
        event_type: eventType,
        actor_id: actorId,
    });
}
