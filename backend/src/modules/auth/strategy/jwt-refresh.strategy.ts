import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../../../config/app-config.service';
import { JwtRefreshPayload } from '../types/auth.types';

type RefreshRequest = {
  cookies?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
};

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(private readonly appConfigService: AppConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: RefreshRequest) => req.cookies?.refreshToken ?? null,
        ExtractJwt.fromBodyField('refreshToken'),
      ]),
      secretOrKey: appConfigService.jwtRefreshSecret,
      ignoreExpiration: false,
    });
  }

  validate(payload: JwtRefreshPayload) {
    if (payload.tokenType !== 'refresh' || !payload.sid || !payload.uid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return payload;
  }
}
