import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../../../config/app-config.service';
import { UserService } from '../../user/user.service';
import { JwtAccessPayload } from '../types/auth.types';
import { User } from '../../user/user.entity';

type CookieRequest = {
  cookies?: Record<string, string | undefined>;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly appConfigService: AppConfigService,
    private readonly userService: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: CookieRequest) => req.cookies?.accessToken ?? null,
      ]),
      secretOrKey: appConfigService.jwtAccessSecret,
      ignoreExpiration: false,
    });
  }

  async validate(payload: JwtAccessPayload): Promise<User> {
    if (payload.tokenType !== 'access' || !payload.uid) {
      throw new UnauthorizedException('Invalid access token');
    }

    const result = await this.userService.findById(payload.uid);
    if (result.isErr()) {
      throw new UnauthorizedException('User not found');
    }

    return result.value;
  }
}
