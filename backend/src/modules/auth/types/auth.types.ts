export interface AuthUser {
  provider: 'google';
  providerId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName: string;
  picture?: string;
}

export interface JwtAccessPayload {
  jti: string;
  sub: string;
  uid: string;
  email: string;
  provider: 'google';
  tokenType: 'access';
}

export interface JwtRefreshPayload {
  sub: string;
  uid: string;
  sid: string;
  email: string;
  provider: 'google';
  tokenType: 'refresh';
}

/**
 * The `*ExpiresIn` fields are in seconds — NOT a suffixed string. The frontend
 * parses these with `Number()` and schedules a proactive refresh ~60s before
 * expiry. When this was a string like "600s" the math silently resolved to NaN
 * and `setTimeout(fn, NaN)` fired on the next tick, creating a refresh storm
 * that tripped rapid-refresh anomaly detection and destabilized sessions.
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
}

export interface ExtendedClientInfo {
  ipAddress?: string;
  userAgent?: string;
  country?: string;
  isVpnOrProxy?: boolean;
}
