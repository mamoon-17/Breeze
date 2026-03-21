import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import { toHttpException } from '../../../common/errors/error-handler';
import { AppConfigService } from '../../../config/app-config.service';
import { AuthService } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private readonly appConfigService: AppConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: appConfigService.googleClientId,
      clientSecret: appConfigService.googleClientSecret,
      callbackURL: appConfigService.googleCallbackUrl,
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) {
    const result = this.authService.validateGoogleUser(profile);
    if (result.isErr()) {
      const exception = toHttpException(result.error);
      done(exception);
      return;
    }
    done(null, result.value);
  }
}
