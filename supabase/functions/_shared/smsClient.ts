// @ts-types="jsr:@supabase/functions-js/edge-runtime.d.ts"
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const AT_API_KEY  = Deno.env.get("AT_API_KEY")  ?? "";
const AT_USERNAME = Deno.env.get("AT_USERNAME") ?? "";
const AT_SMS_URL  = "https://api.africastalking.com/version1/messaging";

// ---------------------------------------------------------------------------
// Internal: secondary channel — push_notifications queue
// PRIVACY: uses guideId (UUID) only; never stores raw phone/name.
// ---------------------------------------------------------------------------
async function sendPushFallback(
    admin:      SupabaseClient,
    guideId:    string,
    message:    string,
    incidentId?: string,
): Promise<void> {
    console.warn(
        `[PUSH_FALLBACK] SMS unavailable — queuing push for guide ${guideId}`,
    );

    const { error } = await admin.from("push_notifications").insert({
        recipient_id: guideId,
        incident_id:  incidentId ?? null,
        message,
        channel: "PUSH",
        status:  "PENDING",
    });

    if (error) {
        console.error(
            `[PUSH_FALLBACK] Failed to queue push for guide ${guideId}:`,
            error.message,
        );
    }
}

// ---------------------------------------------------------------------------
// Internal: primary channel — Africa's Talking SMS
// On failure: logs audit event + falls back to push.
// ---------------------------------------------------------------------------
async function sendSmsRaw(
    admin:   SupabaseClient,
    to:      string,
    message: string,
    opts:    { guideId?: string; incidentId?: string },
): Promise<boolean /* smsSent */> {
    const body = new URLSearchParams({
        username: AT_USERNAME,
        to,
        message,
        from: "RESCUEME",
    });

    try {
        const res = await fetch(AT_SMS_URL, {
            method: "POST",
            headers: {
                "Accept":       "application/json",
                "apiKey":       AT_API_KEY,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
        });

        if (res.ok) return true;

        // --- Circuit breaker: primary channel failed ---
        const errText = await res.text();
        console.error(`[sendSms] FAILED (HTTP ${res.status}):`, errText);

        // Log failure to audit ledger (no PII — guide referenced by id only)
        if (opts.incidentId) {
            await admin.from("incident_logs").insert({
                incident_id: opts.incidentId,
                event_type:  "NOTIFICATION_FAILURE",
                actor_id:    opts.guideId ?? null,
                metadata:    {
                    channel:     "SMS",
                    http_status: res.status,
                    fallback:    "PUSH",
                },
            });
        }

        return false;
    } catch (err) {
        console.error("[sendSms] Network error:", (err as Error).message);
        if (opts.incidentId) {
            await admin.from("incident_logs").insert({
                incident_id: opts.incidentId,
                event_type:  "NOTIFICATION_FAILURE",
                actor_id:    opts.guideId ?? null,
                metadata:    { channel: "SMS", error: (err as Error).message, fallback: "PUSH" },
            });
        }
        return false;
    }
}

// ---------------------------------------------------------------------------
// Public API: notifyGuide
//
// Single entry point for all guide notifications.
// Priority: SMS (Africa's Talking) → Push (push_notifications queue)
//
// PRIVACY CONTRACT:
//   - `phone` is used only for the outbound SMS request and never persisted.
//   - All audit logs reference actors by UUID (guideId) only.
// ---------------------------------------------------------------------------
export async function notifyGuide(
    admin: SupabaseClient,
    opts: {
        phone:       string | null;   // Guide's phone number for SMS (not logged)
        guideId:     string;          // UUID reference for audit/fallback
        message:     string;
        incidentId?: string;
    },
): Promise<void> {
    if (opts.phone) {
        const smsSent = await sendSmsRaw(admin, opts.phone, opts.message, {
            guideId:    opts.guideId,
            incidentId: opts.incidentId,
        });
        if (smsSent) return;  // Done — SMS delivered
    }

    // No phone, or SMS circuit breaker opened → push fallback
    await sendPushFallback(admin, opts.guideId, opts.message, opts.incidentId);
}
