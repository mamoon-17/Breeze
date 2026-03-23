import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { RefreshSession } from './refresh-session.entity';
import { AppConfigService } from '../../config/app-config.service';

@Injectable()
export class RefreshSessionCleanupService {
  private readonly logger = new Logger(RefreshSessionCleanupService.name);

  constructor(
    private readonly appConfigService: AppConfigService,
    @InjectRepository(RefreshSession)
    private readonly refreshSessionRepository: Repository<RefreshSession>,
  ) {}

  @Cron('0 */8 * * *')
  async deleteExpiredRefreshSessions(): Promise<void> {
    const now = new Date();
    const retentionCutoff = new Date(
      now.getTime() -
        this.appConfigService.refreshReuseDetectionRetentionSeconds * 1000,
    );

    const deleteResult = await this.refreshSessionRepository
      .createQueryBuilder()
      .delete()
      .from(RefreshSession)
      .where(
        'absoluteExpiresAt IS NOT NULL AND absoluteExpiresAt < :retentionCutoff',
        {
          retentionCutoff,
        },
      )
      .orWhere('absoluteExpiresAt IS NULL AND expiresAt < :retentionCutoff', {
        retentionCutoff,
      })
      .execute();

    const deletedCount = deleteResult.affected ?? 0;
    this.logger.log(
      `Refresh-session cleanup ran successfully. Deleted ${deletedCount} expired session(s).`,
    );
  }
}
