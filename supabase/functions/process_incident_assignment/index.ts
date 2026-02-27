// @ts-types="jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { notifyGuide } from "../_shared/smsClient.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNCTION_SECRET = Deno.env.get("FUNCTION_SECRET") ?? "";
const ADMIN_PHONE = Deno.env.get("RESQUE_ME_ADMIN_PHONE") ?? ""; // Admin alert number
const SLA_SECONDS = 120;

// Incident types that require immediate CRITICAL-mode dispatch (15 km radius)
const CRITICAL_INCIDENT_TYPES = new Set(["HEALTH", "MEDICAL"]);

// ---------------------------------------------------------------------------
// Skill map: incident type → required skill tags (ordered by preference)
// ---------------------------------------------------------------------------
const INCIDENT_SKILL_MAP: Record<string, string[]> = {
    HEALTH: ["Nurse", "Doctor", "Paramedic", "CPR_Certified"],
    MEDICAL: ["Nurse", "Doctor", "Paramedic", "CPR_Certified"],
    FIRE: ["Firefighter", "Paramedic"],
    ACCIDENT: ["Mechanic", "Welder", "Paramedic"],
    ABUSE: ["Human_Rights_Officer", "Lawyer", "Paralegal"],
    JUSTICE: ["Lawyer", "Paralegal", "Human_Rights_Officer"],
    LOGISTICS: ["Driver", "Dispatcher", "Vulcanizer"],
    SECURITY: [],  // Any guide
    OTHER: [],  // Any guide
};

// ---------------------------------------------------------------------------
// Helper: append an immutable event to incident_logs
// PRIVACY: metadata must contain only UUIDs and system values — no raw PII.
// ---------------------------------------------------------------------------
async function logEvent(
    admin: SupabaseClient,
    incidentId: string,
    eventType: string,
    actorId: string | null,
    metadata: Record<string, unknown> = {}
): Promise<void> {
    const { error } = await admin.from("incident_logs").insert({
        incident_id: incidentId,
        event_type: eventType,
        actor_id: actorId,
        metadata,
    });
    if (error) console.error(`[logEvent] ${eventType} failed:`, error.message);
}

// ---------------------------------------------------------------------------
// Helper: penalise a non-responding guide + notify via circuit-breaker
// ---------------------------------------------------------------------------
async function penaliseGuide(
    admin: SupabaseClient,
    guideId: string,
    incidentId: string
): Promise<void> {
    // Fetch trust score AND phone for notification
    const { data: profile } = await admin
        .from("profiles")
        .select("trust_score, phone")
        .eq("id", guideId)
        .maybeSingle();

    const profileData = profile as { trust_score: number; phone: string | null } | null;
    const newScore = Math.max(0, (profileData?.trust_score ?? 50) - 10);

    await admin.from("profiles").update({ trust_score: newScore }).eq("id", guideId);

    await admin.rpc("add_tokens", {
        target_user_id: guideId,
        amount_to_add: -10,
        trans_type: "PENALTY",
        trans_desc: `SLA Response Failure - incident ${incidentId.slice(0, 8)}`,
    });

    // PRIVACY: audit log references guide by ID only
    await logEvent(admin, incidentId, "RESPONSE_FAILURE", guideId, {
        reason: "Guide did not accept assignment within SLA window",
        trust_score_after: newScore,
        rme_penalty: -10,
    });

    // Notify guide: SMS primary, push fallback (circuit breaker handles routing)
    await notifyGuide(admin, {
        phone: profileData?.phone ?? null,
        guideId,
        incidentId,
        message:
            `[RESCUEME] Incident ${incidentId.slice(-4).toUpperCase()} was not accepted within ` +
            `the ${SLA_SECONDS}s SLA window. Trust score updated to ${newScore}. ` +
            `Contact support if this is an error.`,
    });
}

// ---------------------------------------------------------------------------
// SLA check: runs inside EdgeRuntime.waitUntil() — keeps isolate alive
// ---------------------------------------------------------------------------
async function checkSla(
    admin: SupabaseClient,
    incidentId: string,
    scheduledGuideIds: string[]
): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SLA_SECONDS * 1000));
    console.log(`[SLA_CHECK] Checking incident ${incidentId} after ${SLA_SECONDS}s...`);

    const { data: current } = await admin
        .from("incidents")
        .select("status, accepted_by, assigned_guide_ids")
        .eq("id", incidentId)
        .maybeSingle();

    const currentState = current as {
        status?: string;
        accepted_by?: string | null;
        assigned_guide_ids?: string[]
    } | null;

    if (
        currentState?.accepted_by ||
        ["RESOLVED", "ARCHIVED", "ESCALATED", "ON_SCENE", "ACCEPTED"].includes(currentState?.status ?? "")
    ) {
        console.log(`[SLA_CHECK] Incident ${incidentId} handled in time. No escalation.`);
        return;
    }

    console.warn(`[SLA_CHECK] SLA BREACHED for incident ${incidentId}. Escalating.`);

    await admin.from("incidents").update({
        status: "ESCALATED",
        escalated_at: new Date().toISOString(),
    }).eq("id", incidentId);

    await logEvent(admin, incidentId, "ESCALATED", null, {
        reason: `No guide accepted within ${SLA_SECONDS}s SLA window`,
        assigned_guide_ids: scheduledGuideIds,
    });

    // Only penalise guides who are STILL in the assigned_guide_ids list 
    // (i.e., they didn't reject, but they also didn't accept in time)
    const guidesToPenalise = scheduledGuideIds.filter(id =>
        (currentState?.assigned_guide_ids ?? []).includes(id)
    );

    if (guidesToPenalise.length > 0) {
        await Promise.all(guidesToPenalise.map((gId) => penaliseGuide(admin, gId, incidentId)));
    }
}

// ---------------------------------------------------------------------------
// Find guides with adaptive severity-based radius
// Returns guideIds + the match strategy used for audit logging
// ---------------------------------------------------------------------------
async function findGuides(
    admin: SupabaseClient,
    incident: Record<string, unknown>
): Promise<{ guideIds: string[]; strategy: string; severity: string }> {
    const incidentType = (incident.type as string ?? "OTHER").toUpperCase();
    const requiredSkills = INCIDENT_SKILL_MAP[incidentType] ?? [];
    const severity = CRITICAL_INCIDENT_TYPES.has(incidentType) ? "CRITICAL" : "STANDARD";

    const lat = incident.latitude as number | undefined;
    const lng = incident.longitude as number | undefined;
    const hasGeo = lat != null && lng != null;

    // --- Attempt 1: skill-matched + geo-nearest (severity-aware radius) ---
    if (hasGeo && requiredSkills.length > 0) {
        const { data } = await admin.rpc("get_nearest_guides", {
            incident_lat: lat,
            incident_lng: lng,
            max_results: 2,
            required_skills: requiredSkills,
            incident_severity: severity,
        });
        const ids = ((data as { id: string }[]) ?? []).map((g) => g.id);
        if (ids.length > 0) return { guideIds: ids, strategy: "skill_geo_nearest", severity };
    }

    // --- Attempt 2: skill-matched, ignore geo ---
    if (requiredSkills.length > 0) {
        const { data } = await admin
            .from("profiles")
            .select("id")
            .eq("role", "GUIDE")
            .contains("skills_set", requiredSkills.slice(0, 1))
            .order("trust_score", { ascending: false })
            .limit(2);
        const ids = ((data as { id: string }[]) ?? []).map((g) => g.id);
        if (ids.length > 0) return { guideIds: ids, strategy: "skill_trust_fallback", severity };
    }

    // --- Attempt 3: any guide, geo-nearest (severity-aware radius) ---
    if (hasGeo) {
        const { data } = await admin.rpc("get_nearest_guides", {
            incident_lat: lat,
            incident_lng: lng,
            max_results: 2,
            required_skills: null,
            incident_severity: severity,
        });
        const ids = ((data as { id: string }[]) ?? []).map((g) => g.id);
        if (ids.length > 0) return { guideIds: ids, strategy: "any_geo_nearest", severity };
    }

    // --- Attempt 4: any guide, by trust score ---
    const { data } = await admin
        .from("profiles")
        .select("id")
        .eq("role", "GUIDE")
        .order("trust_score", { ascending: false })
        .limit(2);
    const ids = ((data as { id: string }[]) ?? []).map((g) => g.id);
    return { guideIds: ids, strategy: "any_trust_fallback", severity };
}

// ---------------------------------------------------------------------------
// Main Deno handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    if (!FUNCTION_SECRET || token !== FUNCTION_SECRET) {
        return new Response("Unauthorized", { status: 401 });
    }

    let payload: { record?: Record<string, unknown> };
    try {
        payload = await req.json();
    } catch {
        return new Response("Invalid JSON", { status: 400 });
    }

    const incident = payload?.record;
    if (!incident?.id) {
        return new Response("Missing incident record", { status: 400 });
    }

    const incidentId = incident.id as string;
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false },
    });

    // Find the best matched guides (severity-aware radius applied internally)
    const { guideIds, strategy, severity } = await findGuides(admin, incident);

    if (guideIds.length === 0) {
        const isCritical = severity === "CRITICAL";

        console.warn(
            `[process_incident_assignment] No guides available — severity: ${severity}, ` +
            `incident: ${incidentId}`
        );

        // For CRITICAL incidents with zero guides, log admin escalation immediately
        await logEvent(
            admin,
            incidentId,
            isCritical ? "ESCALATE_TO_ADMIN" : "NO_GUIDES_AVAILABLE",
            null,
            {
                incident_type: incident.type,
                severity,
                required_skills: INCIDENT_SKILL_MAP[(incident.type as string ?? "OTHER").toUpperCase()] ?? [],
                reason: isCritical
                    ? "No guides found within 15 km for CRITICAL incident — manual dispatch required"
                    : "No guides currently available for assignment",
            }
        );

        // Alert admin by SMS/push if CRITICAL and RESQUE_ME_ADMIN_PHONE is configured
        if (isCritical && ADMIN_PHONE) {
            await notifyGuide(admin, {
                phone: ADMIN_PHONE,
                guideId: "00000000-0000-0000-0000-000000000000",  // System actor sentinel UUID
                incidentId,
                message:
                    `[RESCUEME ALERT] CRITICAL incident ${incidentId.slice(-4).toUpperCase()} ` +
                    `(${incident.type}) has NO guides within 15 km. ` +
                    `Manual dispatch required immediately.`,
            });
        }

        return new Response(
            JSON.stringify({
                status: isCritical ? "escalated_to_admin" : "no_guides",
                incident_id: incidentId,
                severity,
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 }
        );
    }

    const slaDeadline = new Date(Date.now() + SLA_SECONDS * 1000).toISOString();

    const { error: assignError } = await admin.from("incidents").update({
        status: "ASSIGNED",
        assigned_guide_ids: guideIds,
        sla_deadline: slaDeadline,
    }).eq("id", incidentId);

    if (assignError) {
        console.error("[process_incident_assignment] Assignment failed:", assignError.message);
        return new Response("Assignment failed", { status: 500 });
    }

    await logEvent(admin, incidentId, "ASSIGNED", null, {
        assigned_guide_ids: guideIds,
        sla_deadline: slaDeadline,
        severity,
        required_skills: INCIDENT_SKILL_MAP[(incident.type as string ?? "OTHER").toUpperCase()] ?? [],
        match_strategy: strategy,
    });

    // Keep isolate alive for the SLA check after 120 seconds
    // @ts-ignore: EdgeRuntime is a Supabase-specific global
    EdgeRuntime.waitUntil(checkSla(admin, incidentId, [...guideIds]));

    return new Response(
        JSON.stringify({
            status: "assigned",
            incident_id: incidentId,
            assigned_guides: guideIds,
            sla_deadline: slaDeadline,
            severity,
            match_strategy: strategy,
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 }
    );
});
