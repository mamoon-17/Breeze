import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../../../config/app-config.service';
import { JwtAccessPayload } from '../types/auth.types';

type CookieRequest = {
  cookies?: Record<string, string | undefined>;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly appConfigService: AppConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: CookieRequest) => req.cookies?.accessToken ?? null,
      ]),
      secretOrKey: appConfigService.jwtAccessSecret,
      ignoreExpiration: false,
    });
  }

  validate(payload: JwtAccessPayload) {
    return payload;
  }
}
