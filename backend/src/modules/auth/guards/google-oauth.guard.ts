import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthGuard, IAuthModuleOptions } from '@nestjs/passport';
import type { Request } from 'express';
import { AppConfigService } from '../../../config/app-config.service';

/**
 * Ensures Google OAuth is configured before Passport runs. Without this, the
 * app would need dummy GOOGLE_* values just to boot in local dev.
 *
 * Also forwards a whitelisted `prompt` query param through to Google so the
 * frontend can distinguish sign-in (silent re-use of the current Google
 * session) from sign-up (show the account chooser / force consent).
 */
@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  constructor(private readonly appConfig: AppConfigService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (!this.appConfig.googleOAuthConfigured) {
      throw new ServiceUnavailableException(
        'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env',
      );
    }
    return super.canActivate(context);
  }

  getAuthenticateOptions(
    context: ExecutionContext,
  ): IAuthModuleOptions | undefined {
    const req = context.switchToHttp().getRequest<Request>();
    const prompt = typeof req.query?.prompt === 'string' ? req.query.prompt : undefined;
    // Whitelist the values Google actually supports to avoid pass-through of
    // arbitrary junk into the OAuth redirect.
    const allowed = new Set(['none', 'consent', 'select_account']);
    if (prompt && allowed.has(prompt)) {
      return { prompt };
    }
    return undefined;
  }
}
