# Refresh Event Logging

Comprehensive logging of all refresh token operations for security monitoring and anomaly detection.

## Overview

Every time a user refreshes their tokens, we log detailed metadata to the `refresh_events` table. This creates an audit trail for:
- ✅ Security monitoring
- ✅ Anomaly detection
- ✅ User behavior analysis
- ✅ Fraud prevention
- ✅ Compliance/auditing

## Database Schema

### `refresh_events` Table

```sql
CREATE TABLE refresh_events (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  family_id UUID NOT NULL,
  session_id UUID NOT NULL,
  ip_prefix VARCHAR(50),
  country VARCHAR(10),
  user_agent_hash VARCHAR(64),
  user_agent_raw VARCHAR(255),
  was_successful BOOLEAN DEFAULT false,
  failure_reason VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX idx_refresh_events_user_created ON refresh_events(user_id, created_at);
CREATE INDEX idx_refresh_events_family_created ON refresh_events(family_id, created_at);
CREATE INDEX idx_refresh_events_created ON refresh_events(created_at);
```

## What Gets Logged

### On Every Refresh Attempt

| Field | Description | Example |
|-------|-------------|---------|
| `userId` | User's UUID | `"550e8400-e29b-41d4-a716-446655440000"` |
| `familyId` | Session family ID (for tracking rotation chains) | `"660e8400-e29b-41d4-a716-446655440111"` |
| `sessionId` | New session ID created | `"770e8400-e29b-41d4-a716-446655440222"` |
| `ipPrefix` | Anonymized IP (last octet removed for IPv4, last 4 groups for IPv6) | `"192.168.1.0"` or `"2001:db8::`" |
| `country` | Country code (future: from GeoIP) | `"US"` (not yet implemented) |
| `userAgentHash` | SHA-256 hash of user agent | `"a3f8b2..."` |
| `userAgentRaw` | Full user agent string (for analysis) | `"Mozilla/5.0..."` |
| `wasSuccessful` | Whether refresh succeeded | `true` or `false` |
| `failureReason` | Reason for failure | `"Invalid token payload"` |
| `createdAt` | Timestamp of event | `"2026-03-24T10:30:00Z"` |

## Privacy Considerations

### IP Address Anonymization

We store **IP prefixes only**, not full IP addresses:

**IPv4:**
- Full IP: `192.168.1.123`
- Stored: `192.168.1.0` (last octet zeroed)
- Preserves: Network location without individual identification

**IPv6:**
- Full IP: `2001:0db8:85a3:0000:0000:8a2e:0370:7334`
- Stored: `2001:0db8:85a3:0000` (first 4 groups only)
- Preserves: ISP/region without individual identification

### User Agent Hashing

- **Raw user agent** stored for analysis (can be deleted after processing)
- **SHA-256 hash** stored permanently for pattern matching
- Same device = same hash, even if raw data is deleted

## Use Cases

### 1. Detect Token Reuse (Security Breach)

If an attacker steals a refresh token and uses it from a different location:

```typescript
// Query: Recent refreshes for a user
const events = await refreshEventService.getRecentEventsByUser(userId, 10);

// Check for:
// - IP prefix changes
// - User agent changes
// - Rapid location switches
// - Multiple concurrent sessions
```

### 2. Detect Brute Force Attacks

Track failed refresh attempts:

```typescript
const since = new Date(Date.now() - 3600000); // Last hour
const failed = await refreshEventService.getFailedEventsByUser(userId, since);

if (failed.value.length > 10) {
  // Alert: Possible brute force attack
  await blockUser(userId);
}
```

### 3. Track Session Families

Follow the lineage of a session through rotations:

```typescript
const familyEvents = await refreshEventService.getRecentEventsByFamily(familyId);

// Shows:
// - Session A rotated to Session B
// - Session B rotated to Session C
// - Session C rotated to Session D (current)
```

### 4. Behavioral Analysis

Identify anomalies:
- User usually refreshes from US, suddenly from Russia
- User usually uses Chrome on Mac, suddenly Firefox on Windows
- User refreshes every 9 minutes (token TTL = 10 min), suddenly every 30 seconds

## Implementation Details

### AuthService Integration

```typescript
await this.refreshEventService.logRefreshEvent({
  userId: payload.uid,
  familyId: currentSession.familyId,
  sessionId: newSessionId,
  ipAddress: clientInfo?.ipAddress,
  userAgent: clientInfo?.userAgent,
  wasSuccessful: true,
});
```

### Failure Logging

Logs are created even on failures:

```typescript
// Invalid token payload
await this.refreshEventService.logRefreshEvent({
  userId: payload.uid || 'unknown',
  familyId: 'unknown',
  sessionId: payload.sid || 'unknown',
  ipAddress: clientInfo?.ipAddress,
  userAgent: clientInfo?.userAgent,
  wasSuccessful: false,
  failureReason: 'Invalid token payload',
});
```

### Client Info Extraction

The `@ClientInfo()` decorator extracts:

```typescript
{
  ipAddress: req.headers['x-forwarded-for'] || req.ip,
  userAgent: req.headers['user-agent']
}
```

Supports:
- Direct connections: `req.ip`
- Behind proxy: `X-Forwarded-For` header
- Behind Cloudflare: `X-Real-IP` header

## Querying Event Data

### Get Recent Events for User

```typescript
const result = await refreshEventService.getRecentEventsByUser(userId, 50);
if (result.isOk()) {
  const events = result.value;
  // Analyze patterns
}
```

### Get Failed Attempts

```typescript
const oneHourAgo = new Date(Date.now() - 3600000);
const result = await refreshEventService.getFailedEventsByUser(userId, oneHourAgo);

if (result.isOk()) {
  const failedAttempts = result.value;
  if (failedAttempts.length > 5) {
    // Alert security team
  }
}
```

### Get Session Family History

```typescript
const result = await refreshEventService.getRecentEventsByFamily(familyId, 100);
if (result.isOk()) {
  const history = result.value;
  // Trace session lineage
}
```

## Anomaly Detection Patterns

### Geographic Anomalies

```typescript
const recentEvents = await getRecentEventsByUser(userId, 10);

const uniqueIPPrefixes = new Set(
  recentEvents.map(e => e.ipPrefix).filter(Boolean)
);

if (uniqueIPPrefixes.size > 3) {
  // User refreshing from multiple locations rapidly
  // Possible account sharing or compromise
}
```

### Device Changes

```typescript
const recentEvents = await getRecentEventsByUser(userId, 10);

const uniqueAgentHashes = new Set(
  recentEvents.map(e => e.userAgentHash).filter(Boolean)
);

if (uniqueAgentHashes.size > 2) {
  // User using multiple devices
  // Normal or suspicious depending on frequency
}
```

### Unusual Refresh Frequency

```typescript
const last10 = await getRecentEventsByUser(userId, 10);

const timestamps = last10.map(e => e.createdAt.getTime());
const intervals = [];

for (let i = 1; i < timestamps.length; i++) {
  intervals.push(timestamps[i-1] - timestamps[i]);
}

const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

if (avgInterval < 60000) { // Less than 1 minute
  // Abnormally fast refreshes
  // Possible automated attack
}
```

## Data Retention

### Recommended Retention Periods

| Purpose | Retention |
|---------|-----------|
| Active monitoring | 30 days |
| Fraud investigation | 90 days |
| Compliance/audit | 1 year |
| Legal hold | As required |

### Cleanup Strategy

```typescript
// Delete events older than 90 days
DELETE FROM refresh_events
WHERE created_at < NOW() - INTERVAL '90 days'
  AND was_successful = true;

// Keep failed attempts for 1 year
DELETE FROM refresh_events  
WHERE created_at < NOW() - INTERVAL '1 year'
  AND was_successful = false;
```

## Performance Considerations

### Indexes

The table has strategic indexes for common queries:
- `(user_id, created_at)` - User timeline queries
- `(family_id, created_at)` - Session family tracking
- `(created_at)` - Time-range queries for cleanup

### Write Performance

- **Async logging**: Events are logged asynchronously (fire-and-forget)
- **No blocking**: Failed logging doesn't break the refresh flow
- **Batching**: Future improvement - batch inserts every N seconds

### Storage Growth

Estimate storage needs:

```
Events per day = Daily Active Users × Average Refreshes per User
              = 10,000 users × 50 refreshes
              = 500,000 events/day

Storage per event ≈ 500 bytes
Daily storage = 500,000 × 500 bytes = 250 MB/day
Monthly storage = 250 MB × 30 = 7.5 GB/month
```

## Future Enhancements

### 1. GeoIP Integration

```typescript
import geoip from 'geoip-lite';

const geo = geoip.lookup(ipAddress);
if (geo) {
  event.country = geo.country;
  event.city = geo.city;
  event.region = geo.region;
}
```

### 2. Risk Scoring

```typescript
interface RiskScore {
  score: number; // 0-100
  factors: string[];
}

function calculateRiskScore(events: RefreshEvent[]): RiskScore {
  let score = 0;
  const factors: string[] = [];

  // Multiple IPs
  const uniqueIPs = new Set(events.map(e => e.ipPrefix));
  if (uniqueIPs.size > 3) {
    score += 30;
    factors.push('Multiple IP addresses');
  }

  // Failed attempts
  const failed = events.filter(e => !e.wasSuccessful);
  if (failed.length > 5) {
    score += 40;
    factors.push('High failure rate');
  }

  // Rapid refreshes
  // ... more checks

  return { score, factors };
}
```

### 3. Real-time Alerts

```typescript
// Webhook integration
if (riskScore > 70) {
  await sendSlackAlert({
    channel: '#security-alerts',
    text: `⚠️ High-risk activity detected for user ${userId}`,
    score: riskScore,
    factors: riskFactors,
  });
}
```

### 4. Machine Learning

Train a model on historical events to detect anomalies:
- Normal user behavior patterns
- Known attack patterns
- Device fingerprinting
- Behavioral biometrics

## Security Recommendations

✅ **DO:**
- Monitor failed refresh attempts
- Alert on geographic anomalies
- Track concurrent sessions
- Analyze refresh patterns
- Keep logs encrypted at rest
- Implement log rotation

❌ **DON'T:**
- Store full IP addresses (privacy violation)
- Log sensitive payload data
- Keep logs indefinitely (storage cost + privacy)
- Expose raw logs to frontend
- Use for non-security purposes without consent

## Compliance Notes

### GDPR Considerations

- IP prefix anonymization = pseudonymization (better than full IP)
- User agent hashing = one-way transformation
- Users have right to:
  - Access their event logs
  - Request deletion
  - Export in machine-readable format

### Implementation

```typescript
// GDPR: Export user's event data
async exportUserEvents(userId: string): Promise<RefreshEvent[]> {
  const result = await this.getRecentEventsByUser(userId, 1000);
  return result.isOk() ? result.value : [];
}

// GDPR: Delete user's event data
async deleteUserEvents(userId: string): Promise<void> {
  await this.refreshEventRepository.delete({ userId });
}
```

## Monitoring Dashboard

Future: Build a dashboard showing:
- Refresh events per hour/day
- Success vs failure rate
- Geographic distribution
- Device/browser breakdown
- Top users by refresh frequency
- Suspicious activity alerts

## Summary

Refresh event logging provides:
- 🔒 **Security** - Detect compromised tokens
- 📊 **Analytics** - Understand user behavior
- ⚠️ **Alerts** - Real-time threat detection
- 🕵️ **Forensics** - Investigate incidents
- ✅ **Compliance** - Audit trail for regulations

All while respecting user privacy through anonymization and hashing.
