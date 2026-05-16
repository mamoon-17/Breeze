import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AppConfigService } from '../../config/app-config.service';
import { CallService } from './call.service';
import { createHmac } from 'crypto';

@Controller('call')
@UseGuards(JwtAuthGuard)
export class CallController {
  constructor(
    private readonly callService: CallService,
    private readonly appConfig: AppConfigService,
  ) {}

  /**
   * Returns ICE servers (STUN + optionally TURN with short-lived credentials).
   * TURN credentials use the coturn `use-auth-secret` HMAC pattern.
   */
  @Get('ice-servers')
  getIceServers() {
    const servers: Array<{
      urls: string | string[];
      username?: string;
      credential?: string;
    }> = [];

    // Always include public STUN
    servers.push({ urls: 'stun:stun.l.google.com:19302' });
    servers.push({ urls: 'stun:stun1.l.google.com:19302' });

    const turnUrl = this.appConfig.turnUrl;
    const turnSecret = this.appConfig.turnSecret;

    if (turnUrl && turnSecret) {
      const ttl = this.appConfig.iceServersTtlSeconds;
      const expiry = Math.floor(Date.now() / 1000) + ttl;
      const username = `${expiry}:breeze`;
      const credential = createHmac('sha1', turnSecret)
        .update(username)
        .digest('base64');

      servers.push({
        urls: turnUrl,
        username,
        credential,
      });
    }

    return {
      iceServers: servers,
      ttlSeconds: this.appConfig.iceServersTtlSeconds,
    };
  }

  /**
   * Paginated call history for the authenticated user.
   */
  @Get('history')
  async getHistory(
    @Req() req: { user: { id: string } },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const clamped = Math.min(Math.max(limit, 1), 100);
    const { records, total } = await this.callService.getHistory(
      req.user.id,
      page,
      clamped,
    );
    return { records, total, page, limit: clamped };
  }
}
