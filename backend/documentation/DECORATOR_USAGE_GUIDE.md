# Decorator Usage Guide

This document explains what each custom decorator does and when to use it.

---

## 🎯 Decorator Overview

| Decorator | Returns | Used With Guard | Purpose |
|-----------|---------|-----------------|---------|
| `@User()` | `User` entity | `JwtAuthGuard` | Get authenticated user from database |
| `@RefreshPayload()` | `JwtRefreshPayload` | `JwtRefreshAuthGuard` | Get refresh token JWT payload |
| `@RefreshToken()` | `string` (raw JWT) | `JwtRefreshAuthGuard` | Get raw refresh token string |
| `@AccessToken()` | `string` (raw JWT) | `JwtAuthGuard` | Get raw access token string |

---

## 1. `@User()` Decorator

**File:** `decorators/current-user.decorator.ts`

### What it does:
- Extracts the **User entity** from `req.user`
- Only works with `@UseGuards(JwtAuthGuard)`

### How it works:
```typescript
JwtAuthGuard → JwtStrategy.validate() → Returns User entity → Attached to req.user
                                                                        ↓
                                                              @User() extracts it
```

### Returns:
```typescript
{
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  provider: string;
  providerId: string;
  picture: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### Usage:
```typescript
@Get('me')
@UseGuards(JwtAuthGuard)
getMe(@User() user: UserEntity) {
  // user is the full User entity from database
  return { user };
}
```

### ⚠️ Important:
- **Triggers a database lookup** (UserService.findById)
- Use when you need full user data
- `req.user` is set by JwtStrategy which returns a User entity

---

## 2. `@RefreshPayload()` Decorator

**File:** `decorators/current-refresh-payload.decorator.ts`

### What it does:
- Extracts the **JWT refresh token payload** from `req.user`
- Only works with `@UseGuards(JwtRefreshAuthGuard)`

### How it works:
```typescript
JwtRefreshAuthGuard → JwtRefreshStrategy.validate() → Returns JwtRefreshPayload → Attached to req.user
                                                                                           ↓
                                                                               @RefreshPayload() extracts it
```

### Returns:
```typescript
{
  sub: string;          // Provider ID
  uid: string;          // User ID
  sid: string;          // Session ID
  email: string;
  provider: 'google';
  tokenType: 'refresh';
}
```

### Usage:
```typescript
@Post('refresh')
@UseGuards(JwtRefreshAuthGuard)
async refresh(
  @RefreshPayload() payload: JwtRefreshPayload,
  @RefreshToken() rawToken: string | undefined
) {
  // payload contains decoded JWT data
  // Use payload.uid, payload.sid for session validation
}
```

### ⚠️ Important:
- **Does NOT trigger database lookup** (no User entity)
- JwtRefreshStrategy just returns the decoded payload
- Use when you only need token data (uid, sid, email)
- More efficient than fetching full user

---

## 3. `@RefreshToken()` Decorator

**File:** `decorators/refresh-token.decorator.ts`

### What it does:
- Extracts the **raw refresh token string** from cookies or request body
- Works with any guard (typically `JwtRefreshAuthGuard`)

### How it works:
```typescript
Request → Check cookies.refreshToken → If not found, check body.refreshToken → Return string
                                                                                       ↓
                                                                          @RefreshToken() extracts it
```

### Returns:
```typescript
string | undefined  // e.g., "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOi..."
```

### Usage:
```typescript
@Post('logout')
@UseGuards(JwtRefreshAuthGuard)
async logout(
  @RefreshPayload() payload: JwtRefreshPayload,
  @RefreshToken() rawToken: string | undefined
) {
  if (!rawToken) {
    throw new Error('Refresh token not found');
  }
  
  // Use rawToken to verify hash in database
  await authService.logoutSession(payload, rawToken);
}
```

### ⚠️ Important:
- Returns the **actual JWT string**, not decoded data
- Needed to verify token hash in database (for refresh token rotation)
- Checks both cookies and body for flexibility

---

## 4. `@AccessToken()` Decorator

**File:** `decorators/access-token.decorator.ts`

### What it does:
- Extracts the **raw access token string** from Authorization header or cookies
- Works with any guard (typically `JwtAuthGuard`)

### How it works:
```typescript
Request → Check Authorization: Bearer <token> → If not found, check cookies.accessToken → Return string
                                                                                                 ↓
                                                                                    @AccessToken() extracts it
```

### Returns:
```typescript
string | undefined  // e.g., "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOi..."
```

### Usage:
```typescript
@Post('logout-all')
@UseGuards(JwtAuthGuard)
async logoutAll(
  @User() user: UserEntity,
  @AccessToken() rawToken: string | undefined
) {
  if (!rawToken) {
    throw new Error('Access token not found');
  }
  
  // Decode to get jti for blacklisting
  const decoded = jwtService.decode(rawToken) as JwtAccessPayload;
  await authService.logoutWithAccessToken(decoded.jti, user.id);
}
```

### ⚠️ Important:
- Returns the **actual JWT string**, not decoded data
- Needed to extract `jti` for token blacklisting
- Checks Authorization header first, then cookies

---

## 🔄 Complete Flow Examples

### Example 1: Get Current User Info

```typescript
@Get('me')
@UseGuards(JwtAuthGuard)
getMe(@User() user: UserEntity) {
  // ✅ Use @User() when you need full user data from DB
  return { user };
}
```

**Flow:**
1. Client sends access token
2. JwtAuthGuard validates token
3. JwtStrategy does DB lookup → returns User entity
4. User entity attached to req.user
5. @User() extracts it

---

### Example 2: Refresh Tokens

```typescript
@Post('refresh')
@UseGuards(JwtRefreshAuthGuard)
async refresh(
  @RefreshPayload() payload: JwtRefreshPayload,  // Decoded JWT data
  @RefreshToken() rawToken: string | undefined    // Raw JWT string
) {
  // ✅ Use @RefreshPayload() for token data
  // ✅ Use @RefreshToken() for hash verification
  
  await authService.refreshTokens(payload, rawToken);
}
```

**Flow:**
1. Client sends refresh token
2. JwtRefreshAuthGuard validates token
3. JwtRefreshStrategy returns decoded payload
4. Payload attached to req.user
5. @RefreshPayload() extracts decoded data
6. @RefreshToken() extracts raw string from cookies/body

---

### Example 3: Logout with Access Token

```typescript
@Post('logout-all')
@UseGuards(JwtAuthGuard)
async logoutAll(
  @User() user: UserEntity,                       // User from DB
  @AccessToken() rawToken: string | undefined     // Raw access token
) {
  // ✅ Use @User() for user.id
  // ✅ Use @AccessToken() to extract jti for blacklisting
  
  const decoded = jwtService.decode(rawToken) as JwtAccessPayload;
  await authService.logoutWithAccessToken(decoded.jti, user.id);
}
```

**Flow:**
1. Client sends access token
2. JwtAuthGuard validates token
3. JwtStrategy does DB lookup → returns User entity
4. User entity attached to req.user
5. @User() extracts User entity
6. @AccessToken() extracts raw JWT string
7. Decode raw token to get jti
8. Blacklist jti in Redis

---

## 🎯 When to Use Which?

### Use `@User()` when:
- ✅ You need full user information from database
- ✅ You're okay with the DB lookup overhead
- ✅ Using `JwtAuthGuard`

### Use `@RefreshPayload()` when:
- ✅ You only need token data (uid, sid, email)
- ✅ You want to avoid extra DB lookup
- ✅ Using `JwtRefreshAuthGuard`

### Use `@RefreshToken()` when:
- ✅ You need to verify token hash in DB
- ✅ You're rotating refresh tokens
- ✅ Using `JwtRefreshAuthGuard`

### Use `@AccessToken()` when:
- ✅ You need to extract jti for blacklisting
- ✅ You need the raw token string
- ✅ Using `JwtAuthGuard`

---

## ⚠️ Common Pitfalls

### ❌ DON'T: Use wrong decorator with wrong guard

```typescript
@Post('endpoint')
@UseGuards(JwtAuthGuard)
async endpoint(@RefreshPayload() payload: JwtRefreshPayload) {
  // ❌ WRONG! JwtAuthGuard attaches User entity, not JwtRefreshPayload
}
```

### ✅ DO: Match decorator to guard

```typescript
@Post('endpoint')
@UseGuards(JwtAuthGuard)
async endpoint(@User() user: UserEntity) {
  // ✅ CORRECT! JwtAuthGuard → User entity
}

@Post('endpoint')
@UseGuards(JwtRefreshAuthGuard)
async endpoint(@RefreshPayload() payload: JwtRefreshPayload) {
  // ✅ CORRECT! JwtRefreshAuthGuard → JwtRefreshPayload
}
```

---

## 📋 Quick Reference Table

| What You Need | Guard | Decorator(s) | Returns |
|---------------|-------|--------------|---------|
| User data from DB | `JwtAuthGuard` | `@User()` | User entity |
| Refresh token data | `JwtRefreshAuthGuard` | `@RefreshPayload()` | JWT payload |
| Raw refresh token | `JwtRefreshAuthGuard` | `@RefreshToken()` | JWT string |
| Raw access token | `JwtAuthGuard` | `@AccessToken()` | JWT string |
| User + Access token | `JwtAuthGuard` | `@User()` + `@AccessToken()` | Both |
| Payload + Refresh token | `JwtRefreshAuthGuard` | `@RefreshPayload()` + `@RefreshToken()` | Both |
