import { Body, Controller, Delete, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/decorators/current-user.decorator';
import { User as UserEntity } from '../user/user.entity';
import { NotificationsService } from './notifications.service';
import { SubscribeDto } from './dto/subscribe.dto';
import { UnsubscribeDto } from './dto/unsubscribe.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('subscribe')
  async subscribe(@User() user: UserEntity, @Body() dto: SubscribeDto) {
    await this.notificationsService.upsertSubscription({
      userId: user.id,
      endpoint: dto.subscription.endpoint,
      p256dh: dto.subscription.keys.p256dh,
      auth: dto.subscription.keys.auth,
      expirationTime: dto.subscription.expirationTime ?? null,
    });

    return { ok: true };
  }

  @Delete('subscribe')
  async unsubscribe(@User() user: UserEntity, @Body() dto: UnsubscribeDto) {
    await this.notificationsService.removeSubscription(user.id, dto.endpoint);
    return { ok: true };
  }
}

