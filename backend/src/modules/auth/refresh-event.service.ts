import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { Result, ok, err } from 'neverthrow';
import { AppError, Errors } from '../../common/errors/app-error';
import { RefreshEvent } from './refresh-event.entity';

interface RefreshEventData {
  userId: string;
  familyId: string;
  sessionId: string;
  ipAddress?: string;
  userAgent?: string;
  wasSuccessful: boolean;
  failureReason?: string;
}

@Injectable()
export class RefreshEventService {
  private readonly logger = new Logger(RefreshEventService.name);

  constructor(
    @InjectRepository(RefreshEvent)
    private readonly refreshEventRepository: Repository<RefreshEvent>,
  ) {}

  async logRefreshEvent(
    data: RefreshEventData,
  ): Promise<Result<void, AppError>> {
    try {
      const event = this.refreshEventRepository.create({
        userId: data.userId,
        familyId: data.familyId,
        sessionId: data.sessionId,
        ipPrefix: this.getIpPrefix(data.ipAddress),
        country: null,
        userAgentHash: data.userAgent
          ? this.hashUserAgent(data.userAgent)
          : null,
        userAgentRaw: data.userAgent || null,
        wasSuccessful: data.wasSuccessful,
        failureReason: data.failureReason || null,
      });

      await this.refreshEventRepository.insert(event);

      this.logger.log(
        `Refresh event logged: userId=${data.userId}, sessionId=${data.sessionId}, success=${data.wasSuccessful}`,
      );

      return ok(undefined);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to log refresh event: ${originalError.message}`);
      return err(Errors.internalError(originalError));
    }
  }

  private getIpPrefix(ipAddress?: string): string | null {
    if (!ipAddress) return null;

    if (ipAddress.includes(':')) {
      const parts = ipAddress.split(':');
      return parts.slice(0, 4).join(':');
    }

    const parts = ipAddress.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }

    return null;
  }

  private hashUserAgent(userAgent: string): string {
    return createHash('sha256').update(userAgent).digest('hex');
  }

  async getRecentEventsByUser(
    userId: string,
    limit: number = 50,
  ): Promise<Result<RefreshEvent[], AppError>> {
    try {
      const events = await this.refreshEventRepository.find({
        where: { userId },
        order: { createdAt: 'DESC' },
        take: limit,
      });

      return ok(events);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(Errors.internalError(originalError));
    }
  }

  async getRecentEventsByFamily(
    familyId: string,
    limit: number = 50,
  ): Promise<Result<RefreshEvent[], AppError>> {
    try {
      const events = await this.refreshEventRepository.find({
        where: { familyId },
        order: { createdAt: 'DESC' },
        take: limit,
      });

      return ok(events);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(Errors.internalError(originalError));
    }
  }

  async getFailedEventsByUser(
    userId: string,
    since: Date,
  ): Promise<Result<RefreshEvent[], AppError>> {
    try {
      const events = await this.refreshEventRepository
        .createQueryBuilder('event')
        .where('event.userId = :userId', { userId })
        .andWhere('event.wasSuccessful = :wasSuccessful', {
          wasSuccessful: false,
        })
        .andWhere('event.createdAt >= :since', { since })
        .orderBy('event.createdAt', 'DESC')
        .getMany();

      return ok(events);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(Errors.internalError(originalError));
    }
  }
}
