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

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: string;
  refreshTokenExpiresIn: string;
}
