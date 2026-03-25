# Phase 3: Anomaly Detection System

This document describes the anomaly detection system implemented for the Breeze authentication system.

## Overview

The anomaly detection system monitors refresh token operations to detect suspicious activity and takes appropriate action based on risk assessment.

## Key Concepts

### Family vs Session
- **familyId**: Represents an entire login session chain on a device. Different devices always get a new familyId.
- **sessionId**: Each refresh rotation within a family generates a new sessionId while keeping the same familyId.
- Anomaly detection only applies **within the same familyId**.

### Risk Levels
- **LOW** (score < 30): Normal activity, no action required
- **MEDIUM** (score 30-59): Suspicious activity, step-up authentication required
- **HIGH** (score >= 60): High-risk activity, immediate session revocation

## Risk Scoring

Each refresh operation is assigned a risk score based on the following signals:

| Signal | Weight | Description |
|--------|--------|-------------|
| Impossible Travel | +80 | Country changed within impossible travel time (< 60 min) |
| Country Changed | +40 | Country different from last event (not impossible travel) |
| User Agent Changed | +20 | Browser/device fingerprint changed |
| Rapid Refreshes | +30 | More than 3 refreshes in 2 minutes |
| Unusual Hour | +10 | Refresh between 2-5 AM UTC |

## Actions by Risk Level

### LOW Risk
- Log the risk score
- Continue normal operation

### MEDIUM Risk
- Log the risk score
- Issue new access token with **2-minute TTL** (instead of default)
- Set `requiresStepUp = true` on the session
- Send asynchronous suspicious activity email notification
- **Session continues** - user is NOT logged out

### HIGH Risk
- Log the risk score
- Revoke entire familyId (all sessions in the family)
- Blacklist all access tokens from the family
- Send forced re-login email notification
- Return **401 Unauthorized**

## VPN/Proxy Handling

The system attempts to detect VPN/proxy connections by:
- Checking for multiple proxy headers
- Analyzing X-Forwarded-For chain length

When VPN/proxy is detected:
- Impossible travel detection is still flagged
- The system logs VPN detection
- Step-up (MEDIUM) is preferred over full revocation to reduce false positives

## Step-up Authentication

When a session has `requiresStepUp = true`:
1. The session remains active for normal operations
2. Protected routes can optionally check this flag using `StepUpRequiredGuard`
3. User can complete step-up via `GET /auth/step-up` (Google OAuth re-authentication)
4. After successful step-up, the flag is cleared

### Checking Step-up Status
```http
GET /auth/step-up/status
Authorization: Bearer <access_token>
```

### Completing Step-up
```http
GET /auth/step-up
```
Redirects to Google OAuth for re-authentication.

## Email Notifications

Notifications are sent asynchronously (fire-and-forget) for:

### New Session
- Triggered on initial login
- Includes: IP prefix, country, device info, timestamp

### Suspicious Activity (MEDIUM Risk)
- Triggered on MEDIUM risk detection
- Includes: IP prefix, country, device info, timestamp, detected signals

### Forced Re-login (HIGH Risk)
- Triggered on HIGH risk detection
- Includes: IP prefix, country, device info, timestamp, reason, detected signals

## Session Management API

### List Active Sessions
```http
GET /auth/sessions
Authorization: Bearer <access_token>
```

Returns all active session families for the user with:
- familyId
- Creation time
- Last activity
- Location/country
- Device summary
- Step-up requirement status

### Revoke Session Family
```http
DELETE /auth/sessions/:familyId
Authorization: Bearer <access_token>
```

### Revoke Other Sessions
```http
POST /auth/sessions/revoke-others
Authorization: Bearer <access_token>
```
Revokes all session families except the current one.

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ANOMALY_DETECTION_ENABLED` | `true` | Enable/disable anomaly detection |
| `ANOMALY_STEPUP_ACCESS_TOKEN_TTL` | `120` | Access token TTL (seconds) for MEDIUM risk |
| `IMPOSSIBLE_TRAVEL_MINUTES` | `60` | Threshold for impossible travel detection |
| `RAPID_REFRESH_WINDOW_MS` | `120000` | Window for rapid refresh detection |
| `RAPID_REFRESH_THRESHOLD` | `3` | Max refreshes before flagging |
| `EMAIL_ENABLED` | `false` | Enable email notifications |
| `SMTP_HOST`, `SMTP_PORT`, etc. | - | SMTP configuration for emails |

## Database Schema Changes

### refresh_sessions
New columns:
- `requiresStepUp` (boolean): Whether step-up is required
- `lastKnownCountry` (varchar): Last known country code
- `lastKnownUserAgentHash` (varchar): Last known UA hash
- `userAgentRaw` (varchar): Raw user agent string
- `ipPrefix` (varchar): Privacy-truncated IP

### refresh_events
New columns:
- `ipAddress` (varchar): Full IP address (for geo lookup)
- `riskScore` (int): Computed risk score
- `riskLevel` (varchar): LOW/MEDIUM/HIGH
- `anomalySignals` (jsonb): Detected signals
- `isVpnOrProxy` (boolean): VPN/proxy detection result

## Important Notes

1. **Reuse detection takes precedence**: If a refresh token is reused, the family is immediately revoked regardless of risk score.

2. **Step-up vs Logout**: Step-up preserves session continuity - the user stays logged in but may need to re-authenticate for sensitive actions. HIGH risk or token reuse triggers full session revocation.

3. **Country detection**: Relies on CDN/reverse proxy headers (Cloudflare, Vercel, etc.) or custom header. Falls back to null if not available.

4. **Migration**: Run the migration `1711500000000-AddAnomalyDetectionFields` to add new columns.
