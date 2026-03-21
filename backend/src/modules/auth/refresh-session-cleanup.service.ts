import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { RefreshSession } from './refresh-session.entity';

@Injectable()
export class RefreshSessionCleanupService {
  private readonly logger = new Logger(RefreshSessionCleanupService.name);

  constructor(
    @InjectRepository(RefreshSession)
    private readonly refreshSessionRepository: Repository<RefreshSession>,
  ) {}

  @Cron('0 */8 * * *')
  async deleteExpiredRefreshSessions(): Promise<void> {
    const now = new Date();

    const deleteResult = await this.refreshSessionRepository
      .createQueryBuilder()
      .delete()
      .from(RefreshSession)
      .where('expiresAt < :now', { now })
      .execute();

    const deletedCount = deleteResult.affected ?? 0;
    this.logger.log(
      `Refresh-session cleanup ran successfully. Deleted ${deletedCount} expired session(s).`,
    );
  }
}
