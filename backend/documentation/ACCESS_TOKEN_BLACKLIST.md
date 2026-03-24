# Access Token Blacklist Implementation

This implementation adds **access token blacklisting** using Redis with hybrid AOF+RDB persistence for immediate token revocation on logout.

## Overview

### Why Token Blacklist?

JWT access tokens are stateless and cannot be invalidated before expiration. This blacklist allows:
- ✅ Immediate logout (revoke access token)
- ✅ Security response (revoke compromised tokens)
- ✅ Force re-authentication
- ✅ Multi-device logout

### Architecture

```
User Logout Request
      ↓
Extract JTI from Access Token
      ↓
Add JTI to Redis Blacklist (TTL = token lifetime)
      ↓
Revoke All Refresh Sessions in DB
      ↓
Clear Cookies
```

On subsequent requests:
```
JWT Guard Validates Token
      ↓
Check Redis Blacklist (by JTI)
      ↓
If Blacklisted → 401 Unauthorized
      ↓
If Not Blacklisted → Continue
```

## Components

### 1. Redis Module (`modules/redis/`)

**redis.module.ts**
- Global module providing Redis connection
- Uses `cache-manager` with `ioredis` store
- Configured with key prefix `breeze:`

**redis.service.ts**
- Wrapper around cache-manager
- Methods: `get()`, `set()`, `del()`, `reset()`

### 2. Token Blacklist Service (`modules/auth/`)

**token-blacklist.service.ts**
- `addToBlacklist(jti, ttl)` - Add token to blacklist with expiration
- `isBlacklisted(jti)` - Check if token is blacklisted
- `removeFromBlacklist(jti)` - Remove token from blacklist
- Uses Redis key pattern: `token:blacklist:{jti}`

### 3. JWT Strategy Update

**strategy/jwt.strategy.ts**
- Before validating user, checks if token JTI is blacklisted
- Throws `UnauthorizedException` if blacklisted
- Prevents access with revoked tokens

### 4. Auth Service

**auth.service.ts**
- `logoutWithAccessToken(jti, userId)` - Blacklist access token + revoke all sessions
- Called when user logs out with access token

### 5. Auth Controller

**auth.controller.ts**
- `POST /auth/logout-all` - Uses access token for logout
  - Extracts JTI and UID from access token payload
  - Blacklists the access token
  - Revokes all refresh sessions
  - Clears cookies

### 6. New Decorators

**decorators/access-payload.decorator.ts**
- `@AccessPayload()` - Extracts full `JwtAccessPayload` (including `jti`)
- Used for logout to get the token ID

## Configuration

### Environment Variables

Add to `.env`:

```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
```

### Redis Setup

#### Option 1: Docker Compose

```yaml
redis:
  image: redis:7-alpine
  command: >
    redis-server
    --appendonly yes
    --aof-use-rdb-preamble yes
    --appendfsync everysec
  ports:
    - "6379:6379"
  volumes:
    - redis-data:/data
```

#### Option 2: Local Installation

```bash
# Install Redis
brew install redis  # macOS
# or
sudo apt install redis-server  # Ubuntu

# Start with hybrid persistence
redis-server --appendonly yes --aof-use-rdb-preamble yes
```

## Usage

### Logout Flow

```typescript
// Client sends POST to /auth/logout-all with access token
// Server automatically:
// 1. Extracts JTI from token
// 2. Adds to Redis blacklist (TTL = token remaining lifetime)
// 3. Revokes all refresh sessions
// 4. Clears cookies
```

### Check Token Status

```typescript
// On every protected route request:
// 1. JWT Guard extracts token
// 2. Validates signature + expiration
// 3. Checks Redis blacklist
// 4. If blacklisted → 401
// 5. If valid → Load user from DB
```

## API Endpoints

### POST `/auth/logout-all`

Logout using access token (immediate effect).

**Headers:**
```
Authorization: Bearer <access_token>
```

**Or Cookie:**
```
accessToken=<access_token>
```

**Response:**
```json
{
  "message": "Logged out from all sessions successfully"
}
```

### POST `/auth/logout`

Logout using refresh token (existing endpoint, still available).

## Redis Persistence Strategy

### Hybrid AOF + RDB

The system uses **hybrid persistence** for optimal performance:

1. **RDB (Snapshot)**
   - Fast to load on restart
   - Periodic snapshots

2. **AOF (Append-Only File)**
   - Logs every write operation
   - Strong durability (minimal data loss)

3. **Hybrid Benefits**
   - RDB preamble for fast startup
   - AOF append for recent operations
   - Auto-rewrite to keep file size manageable

### Data Loss Scenarios

| Scenario | Data Loss | Recovery |
|----------|-----------|----------|
| Normal shutdown | None | Instant |
| Redis crash | < 1 second of operations | Replays AOF |
| Power failure | < 1 second of operations | Replays AOF |
| Disk failure | All data | Blacklist rebuilt naturally as tokens expire |

### Why TTL Matters

- Blacklisted tokens have TTL = token remaining lifetime
- Redis automatically removes expired entries
- No manual cleanup needed
- Storage grows linearly with logout rate

## Performance Considerations

### Redis Operations

- `SET` with TTL: O(1)
- `GET`: O(1)  
- `DEL`: O(1)

### Overhead Per Request

Each protected request adds:
1. Redis `GET` operation (~1ms local, ~5-10ms network)
2. Negligible CPU/memory overhead

### Capacity Planning

Example with 10-minute access tokens:

| Logouts/day | Keys in Redis | Memory Usage |
|-------------|---------------|--------------|
| 1,000       | ~7 avg       | < 1 KB       |
| 10,000      | ~70 avg      | < 10 KB      |
| 100,000     | ~700 avg     | < 100 KB     |

Memory = `(logouts_per_day × 600 seconds / 86400 seconds) × ~100 bytes`

## Monitoring

### Check Redis Status

```bash
redis-cli INFO persistence
redis-cli INFO memory
redis-cli KEYS "breeze:token:blacklist:*"
redis-cli TTL "breeze:token:blacklist:{jti}"
```

### Application Logs

The system logs:
- When tokens are blacklisted
- When blacklisted tokens are rejected
- Redis connection errors

## Security Notes

✅ **Thread-safe**: Redis operations are atomic  
✅ **Race-condition free**: Token check happens in JWT strategy  
✅ **Automatic cleanup**: TTL handles expiration  
✅ **Persistence**: No data loss on restart (with AOF)  
⚠️ **Single point of failure**: If Redis is down, all auth requests fail  
💡 **Solution**: Use Redis Sentinel or Cluster for high availability

## Troubleshooting

### Redis Connection Failed

Check:
1. Redis is running: `redis-cli ping` → Should return `PONG`
2. Environment variables are set correctly
3. Network connectivity to Redis host

### Token Not Blacklisted

Check:
1. JTI is being generated and included in access token
2. `logoutWithAccessToken` is being called
3. Redis TTL: `redis-cli TTL breeze:token:blacklist:{jti}`

### High Memory Usage

1. Check number of keys: `redis-cli DBSIZE`
2. Verify TTL is set correctly: `redis-cli TTL breeze:token:blacklist:*`
3. Consider reducing access token lifetime

## Future Enhancements

- [ ] Redis Cluster support for high availability
- [ ] Metrics dashboard for blacklist stats
- [ ] Graceful degradation if Redis is unavailable
- [ ] Blacklist specific tokens (not just on logout)
- [ ] Admin API to manually revoke tokens
