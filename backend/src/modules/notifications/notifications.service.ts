import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import webpush from 'web-push';
import { AppConfigService } from '../../config/app-config.service';
import { PushSubscriptionEntity } from './push-subscription.entity';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private configured = false;

  constructor(
    private readonly appConfig: AppConfigService,
    @InjectRepository(PushSubscriptionEntity)
    private readonly repo: Repository<PushSubscriptionEntity>,
  ) {}

  private ensureConfigured() {
    if (this.configured) return;
    const subject = this.appConfig.vapidSubject;
    const publicKey = this.appConfig.vapidPublicKey;
    const privateKey = this.appConfig.vapidPrivateKey;

    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.configured = true;
  }

  async upsertSubscription(input: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    expirationTime?: number | null;
  }): Promise<void> {
    const expirationTime =
      input.expirationTime === undefined || input.expirationTime === null
        ? null
        : String(input.expirationTime);

    await this.repo.upsert(
      {
        userId: input.userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        expirationTime,
      },
      ['userId', 'endpoint'],
    );
  }

  async removeSubscription(userId: string, endpoint: string): Promise<void> {
    await this.repo.delete({ userId, endpoint });
  }

  async notifyNewMessage(userId: string, payload: unknown): Promise<void> {
    this.ensureConfigured();

    const subs = await this.repo.find({ where: { userId } });
    if (subs.length === 0) return;

    const body = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: s.endpoint,
              keys: { p256dh: s.p256dh, auth: s.auth },
              expirationTime: s.expirationTime ? Number(s.expirationTime) : null,
            },
            body,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Push send failed; endpoint=${s.endpoint}: ${msg}`);

          // If subscription is gone, remove it.
          const statusCode = (err as unknown as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.repo.delete({ userId, endpoint: s.endpoint });
          }
        }
      }),
    );
  }
}

