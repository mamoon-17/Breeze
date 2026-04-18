import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { AppConfigService } from '../../../config/app-config.service';
import { UserService } from '../../user/user.service';
import { TokenBlacklistService } from '../token-blacklist.service';
import type { JwtAccessPayload } from '../types/auth.types';
import type { AuthenticatedSocket } from '../../../common/types/authenticated-socket';

@Injectable()
export class WsJwtMiddleware {
  private readonly logger = new Logger(WsJwtMiddleware.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly appConfig: AppConfigService,
    private readonly userService: UserService,
    private readonly tokenBlacklistService: TokenBlacklistService,
  ) {}

  /**
   * Returns a Socket.IO use() middleware function.
   * Called once per connection attempt — rejects the handshake on any auth failure.
   */
  build() {
    return async (socket: AuthenticatedSocket, next: (err?: Error) => void) => {
      try {
        const token = this.extractToken(socket);
        if (!token) {
          return next(new UnauthorizedException('No access token provided'));
        }

        let payload: JwtAccessPayload;
        try {
          payload = this.jwtService.verify<JwtAccessPayload>(token, {
            secret: this.appConfig.jwtAccessSecret,
          });
        } catch {
          return next(new UnauthorizedException('Invalid or expired access token'));
        }

        if (payload.tokenType !== 'access' || !payload.uid || !payload.jti) {
          return next(new UnauthorizedException('Invalid token type'));
        }

        const blacklistCheck = await this.tokenBlacklistService.isBlacklisted(payload.jti);
        if (blacklistCheck.isErr()) {
          return next(new UnauthorizedException('Token validation failed'));
        }
        if (blacklistCheck.value) {
          return next(new UnauthorizedException('Token has been revoked'));
        }

        const userResult = await this.userService.findById(payload.uid);
        if (userResult.isErr()) {
          return next(new UnauthorizedException('User not found'));
        }

        socket.data.user = userResult.value;
        socket.data.accessTokenJti = payload.jti;
        socket.data.accessTokenExp = (payload as unknown as { exp?: number }).exp;
        next();
      } catch (err) {
        this.logger.error(`WS auth error: ${err instanceof Error ? err.message : String(err)}`);
        next(new UnauthorizedException('Authentication failed'));
      }
    };
  }

  private extractToken(socket: Socket): string | null {
    // 1. socket.io handshake auth: socket({ auth: { token: '...' } })
    const authToken = (socket.handshake.auth as Record<string, unknown>)?.token;
    if (typeof authToken === 'string' && authToken) {
      return authToken;
    }

    // 2. Authorization header: Bearer <token>
    const authHeader = socket.handshake.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    // 3. Cookie: accessToken=<token>
    const cookieHeader = socket.handshake.headers.cookie;
    if (cookieHeader) {
      const match = /(?:^|;\s*)accessToken=([^;]+)/.exec(cookieHeader);
      if (match?.[1]) {
        return decodeURIComponent(match[1]);
      }
    }

    return null;
  }
}
