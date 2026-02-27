# RescueMe — SMS/USSD Gateway Specification

**Version**: 1.0  
**Provider**: Africa's Talking (provider-agnostic interface)  
**Date**: 2026-02-25

---

## Overview

The USSD/SMS Gateway enables **low-tech access** to the RescueMe network. A Vulcanizer or Mechanic with a feature phone can receive an SOS, accept it, and have their actions logged to `incident_logs` — with no smartphone required.

---

## Message Flows

### Flow 1: Inbound SOS Notification (System → Guide)
When a guide is assigned to an incident, the system sends an SMS:

```
[RESCUEME SOS]
Type: ACCIDENT
Location: 6.4550°N, 3.3841°E
Skill: Mechanic / Vulcanizer needed

Reply:
1 = ACCEPT
2 = REJECT
3 = REQUEST BACKUP

Ref: A3F9 (last 4 chars of incident ID)
```

### Flow 2: Guide Reply (Guide → System)
Guide sends back a single digit:

| Code | Action | Effect |
|---|---|---|
| `1` | ACCEPT | `incidents.accepted_by = guide_id`, `incident_logs: ACCEPTED` |
| `2` | REJECT | Guide removed from `assigned_guide_ids`, system finds next guide |
| `3` | BACKUP | Flags incident as `BACKUP_REQUESTED`, escalates to Admin |

### Flow 3: USSD Session (Richer Interaction)
For networks supporting USSD (`*384#` dial):

```
CON Welcome to RescueMe
1. View my active assignment
2. Accept assignment
3. Report I've arrived on scene
4. Close incident (mark resolved)
```

---

## API Contract

### Endpoint
```
POST /functions/v1/ussd_gateway
```

### Webhook Payload (Africa's Talking format)
```json
{
  "sessionId": "ATsession123",
  "phoneNumber": "+2348012345678",
  "networkCode": "62120",
  "text": "1",
  "serviceCode": "*384#"
}
```

### Auth
- Africa's Talking signs requests with `X-AT-APIKey` header.
- Validate against `AT_API_KEY` environment variable.

### Response (for USSD — must be plain text)
```
END Assignment accepted. Navigate to 6.4550N, 3.3841E.
Stay safe. RescueMe Command is monitoring.
```

### Response (for SMS — send via AT API)
```
[RESCUEME] You have accepted incident A3F9.
Victim is 2.3km away. Trust+5 on completion.
```

---

## Guide Identification by Phone Number
Since feature phones don't have auth tokens, guides are identified by their registered phone number in `profiles.phone`.

```sql
SELECT id FROM profiles WHERE phone = '+2348012345678' AND role = 'GUIDE';
```

This is the only unauthenticated lookup in the system — the Africa's Talking `X-AT-APIKey` header acts as the outer security layer.

---

## Security Considerations

1. **Replay attacks**: Each reply is tied to a `sessionId`. Duplicate `sessionId` + `text` combinations are ignored.
2. **Incident reference**: Replies must match the guide's currently active incident's short ref (last 4 chars of UUID). Orphaned replies are rejected.
3. **Rate limiting**: Max 10 SMS actions per guide per hour.

---

## Deployment

1. Set env vars in Supabase Edge Function secrets:
   ```
   AT_API_KEY        = <Africa's Talking API key>
   AT_USERNAME       = <Africa's Talking username>
   AT_SMS_SHORTCODE  = RESCUEME
   ```

2. Register webhook in Africa's Talking dashboard:
   ```
   https://pveilpyiwggkepbnahqe.supabase.co/functions/v1/ussd_gateway
   ```

3. Configure USSD service code: `*384#` (register via Africa's Talking dashboard).
