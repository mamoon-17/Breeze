import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Interval } from '@nestjs/schedule';
import { In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { AiService } from './ai.service';
import { ReminderJob, ReminderJobStatus } from './reminder-job.entity';
import type { ReminderParseResult } from './dto/schedule-reminder.dto';
import type {
  AiMessageJobRecipients,
  AiMessageJobResult,
} from './ai-message-job.entity';
import { ConversationService } from '../conversation/conversation.service';
import type { HydratedConversation } from '../conversation/conversation.service';
import { ChatService } from '../chat/chat.service';
import { User } from '../user/user.entity';
import { effectiveDisplayName } from '../user/user-projection';
import { SocketStateService } from '../socket/socket-state.service';
import {
  buildReminderUserPrompt,
  reminderSystemPrompt,
} from './prompts/reminder.prompts';
import { SendMessageDto } from '../chat/dto/send-message.dto';
import type { ConversationType } from '../conversation/conversation.entity';

interface ReminderTarget {
  conversationId: string;
  conversationType: ConversationType;
  conversationName: string | null;
  recipientUserId?: string;
  recipientEmail?: string;
  recipientName?: string | null;
}

interface LlmReminderResult {
  recipients?: {
    allConversations?: boolean;
    conversationNames?: string[];
    emails?: string[];
  };
  messageBody?: string;
  scheduledAt?: string;
  confirmationText?: string;
}

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly conversationService: ConversationService,
    private readonly chatService: ChatService,
    private readonly socketState: SocketStateService,
    @InjectRepository(ReminderJob)
    private readonly reminderRepository: Repository<ReminderJob>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  // ─── Create ───────────────────────────────────────────────────────────────────

  async parseAndCreate(
    instruction: string,
    requesterId: string,
    timezone: string,
  ): Promise<ReminderParseResult> {
    const trimmed = instruction.trim();
    if (!trimmed) {
      throw new BadRequestException('Instruction cannot be empty');
    }

    const currentTime = new Date().toLocaleString('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZoneName: 'long',
    });
    const raw = await this.aiService.complete(
      reminderSystemPrompt,
      buildReminderUserPrompt({ instruction: trimmed, currentTime, timezone }),
    );

    let parsed: LlmReminderResult;
    try {
      parsed = JSON.parse(raw) as LlmReminderResult;
    } catch {
      this.logger.error('Reminder parse error — raw response:', raw);
      throw new BadRequestException(
        'Could not parse your reminder instruction. Please try rephrasing.',
      );
    }

    const messageBody =
      typeof parsed.messageBody === 'string' && parsed.messageBody.trim()
        ? parsed.messageBody.trim()
        : trimmed;

    if (!parsed.scheduledAt || !parsed.scheduledAt.trim()) {
      throw new BadRequestException(
        'Please include a specific time for the reminder.',
      );
    }

    const scheduledAt = this.parseScheduledTime(parsed.scheduledAt, timezone);
    const confirmationText =
      typeof parsed.confirmationText === 'string' &&
      parsed.confirmationText.trim()
        ? parsed.confirmationText.trim()
        : `I'll send the reminder at ${scheduledAt.toLocaleString()}.`;

    const recipients: AiMessageJobRecipients = {
      allConversations: Boolean(parsed.recipients?.allConversations),
      conversationNames: this.toStringList(
        parsed.recipients?.conversationNames,
      ),
      emails: this.toStringList(parsed.recipients?.emails, true),
    };

    const job = this.reminderRepository.create({
      requesterId,
      instruction: trimmed,
      messageBody,
      recipients,
      scheduledAt,
      timezone,
      confirmationText,
      status: 'pending_confirmation',
      errorMessage: null,
      results: null,
    });

    const saved = await this.reminderRepository.save(job);

    return {
      jobId: saved.id,
      status: saved.status,
      confirmationText: saved.confirmationText,
      messageBody: saved.messageBody,
      scheduledAt: saved.scheduledAt.toISOString(),
      recipients: {
        allConversations: recipients.allConversations,
        conversationNames: recipients.conversationNames,
        emails: recipients.emails,
      },
    };
  }

  // ─── Confirm / Cancel ─────────────────────────────────────────────────────────

  async confirm(jobId: string, requesterId: string): Promise<ReminderJob> {
    const job = await this.findJobForUser(jobId, requesterId);

    if (job.status !== 'pending_confirmation') {
      throw new BadRequestException(
        `Reminder cannot be confirmed — current status: ${job.status}`,
      );
    }

    job.status = 'scheduled';
    const saved = await this.reminderRepository.save(job);

    // Notify user via WebSocket
    this.socketState.emitToUser(requesterId, 'reminder:queued', {
      jobId: saved.id,
      scheduledAt: saved.scheduledAt.toISOString(),
      messageBody: saved.messageBody,
      confirmationText: saved.confirmationText,
      recipients: saved.recipients,
    });

    return saved;
  }

  async cancel(jobId: string, requesterId: string): Promise<ReminderJob> {
    const job = await this.findJobForUser(jobId, requesterId);

    if (job.status === 'sent' || job.status === 'failed') {
      throw new BadRequestException(
        `Reminder cannot be cancelled — it has already been ${job.status}`,
      );
    }

    job.status = 'cancelled';
    const saved = await this.reminderRepository.save(job);
    return saved;
  }

  // ─── List ─────────────────────────────────────────────────────────────────────

  async getRemindersForUser(requesterId: string): Promise<ReminderJob[]> {
    return this.reminderRepository.find({
      where: {
        requesterId,
        status: In(['pending_confirmation', 'scheduled']),
      },
      order: { scheduledAt: 'ASC' },
    });
  }

  // ─── Polling ──────────────────────────────────────────────────────────────────

  @Interval(5000)
  async processDueReminders(): Promise<void> {
    const now = new Date();
    const dueJobs = await this.reminderRepository.find({
      where: {
        status: 'scheduled' as ReminderJobStatus,
        scheduledAt: LessThanOrEqual(now),
      },
      order: { scheduledAt: 'ASC' },
      take: 5,
    });

    if (dueJobs.length === 0) return;

    for (const job of dueJobs) {
      await this.executeReminder(job);
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────────

  private async executeReminder(job: ReminderJob): Promise<void> {
    // Optimistic lock: only process if still scheduled
    const locked = await this.reminderRepository
      .createQueryBuilder()
      .update(ReminderJob)
      .set({ status: 'sent' as ReminderJobStatus })
      .where('id = :id', { id: job.id })
      .andWhere('status = :status', { status: 'scheduled' })
      .execute();

    if ((locked.affected ?? 0) === 0) return;

    const results: AiMessageJobResult[] = [];

    try {
      const { targets, failures } = await this.resolveTargets(job);
      results.push(...failures);

      if (targets.length === 0) {
        await this.finalizeJob(
          job.id,
          'failed',
          results,
          'No valid recipients',
        );
        return;
      }

      let successCount = 0;

      for (const target of targets) {
        try {
          const dto: SendMessageDto = {
            room: target.conversationId,
            message: job.messageBody,
          };
          const message = await this.chatService.sendMessageAndNotify(
            dto,
            job.requesterId,
          );

          results.push({
            conversationId: target.conversationId,
            conversationName: target.conversationName,
            recipientUserId: target.recipientUserId,
            recipientEmail: target.recipientEmail,
            draft: job.messageBody,
            messageId: message.id,
          });
          successCount += 1;
        } catch (error) {
          const errorMessage = this.formatError(error);
          this.logger.error(
            `Reminder failed for conversation ${target.conversationId}: ${errorMessage}`,
          );
          results.push({
            conversationId: target.conversationId,
            conversationName: target.conversationName,
            recipientUserId: target.recipientUserId,
            recipientEmail: target.recipientEmail,
            error: errorMessage,
          });
        }
      }

      const status: ReminderJobStatus = successCount > 0 ? 'sent' : 'failed';
      const errorMessage =
        successCount === 0
          ? 'All targets failed'
          : results.some((r) => r.error)
            ? 'Some targets failed'
            : null;

      await this.finalizeJob(job.id, status, results, errorMessage);

      // Notify user the reminder was sent
      this.socketState.emitToUser(job.requesterId, 'reminder:sent', {
        jobId: job.id,
        status,
        results,
        errorMessage,
      });
    } catch (error) {
      const errorMessage = this.formatError(error);
      this.logger.error(`Reminder job ${job.id} failed: ${errorMessage}`);
      await this.finalizeJob(job.id, 'failed', results, errorMessage);
    }
  }

  private async finalizeJob(
    jobId: string,
    status: ReminderJobStatus,
    results: AiMessageJobResult[],
    errorMessage: string | null,
  ): Promise<void> {
    await this.reminderRepository.update(
      { id: jobId },
      {
        status,
        results: results.length > 0 ? results : null,
        errorMessage,
      },
    );
  }

  private async findJobForUser(
    jobId: string,
    requesterId: string,
  ): Promise<ReminderJob> {
    const job = await this.reminderRepository.findOne({
      where: { id: jobId, requesterId },
    });
    if (!job) {
      throw new NotFoundException('Reminder not found');
    }
    return job;
  }

  private async resolveTargets(job: ReminderJob): Promise<{
    targets: ReminderTarget[];
    failures: AiMessageJobResult[];
  }> {
    const targets = new Map<string, ReminderTarget>();
    const failures: AiMessageJobResult[] = [];
    const recipients = job.recipients;
    let cachedConversations: HydratedConversation[] | null = null;

    const getUserConversations = async (): Promise<HydratedConversation[]> => {
      if (!cachedConversations) {
        cachedConversations =
          await this.conversationService.getConversationsForUser(
            job.requesterId,
          );
      }
      return cachedConversations;
    };

    if (recipients.allConversations) {
      const conversations = await getUserConversations();
      for (const conversation of conversations) {
        this.addHydratedConversationTarget(targets, conversation);
      }
    }

    if (recipients.conversationIds?.length) {
      for (const conversationId of recipients.conversationIds) {
        try {
          await this.conversationService.requireMember(
            job.requesterId,
            conversationId,
          );
          const conversation =
            await this.conversationService.findOneOrFail(conversationId);
          await this.addConversationTarget(
            targets,
            conversation,
            job.requesterId,
          );
        } catch (error) {
          failures.push({
            conversationId,
            error: this.formatError(error),
          });
        }
      }
    }

    if (recipients.conversationNames?.length) {
      const conversations = await getUserConversations();

      for (const name of recipients.conversationNames) {
        const normalized = name.toLowerCase();
        const matches = conversations.filter((conversation) => {
          const groupMatch =
            conversation.name && conversation.name.toLowerCase() === normalized;
          const dmMatch =
            conversation.type === 'dm' &&
            conversation.peer &&
            (conversation.peer.displayName.toLowerCase() === normalized ||
              conversation.peer.email.toLowerCase() === normalized);
          return groupMatch || dmMatch;
        });

        if (matches.length === 0) {
          failures.push({
            conversationName: name,
            error: 'Conversation name not found',
          });
          continue;
        }

        for (const match of matches) {
          this.addHydratedConversationTarget(targets, match);
        }
      }
    }

    if (recipients.emails?.length) {
      for (const email of recipients.emails) {
        try {
          const conversation =
            await this.conversationService.getOrCreateDmByEmail(
              job.requesterId,
              email,
            );
          const user = await this.userRepository.findOne({
            where: { email },
          });
          await this.addConversationTarget(
            targets,
            conversation,
            job.requesterId,
            {
              recipientEmail: email,
              recipientUserId: user?.id,
              recipientName: user ? effectiveDisplayName(user) : null,
            },
          );
        } catch (error) {
          failures.push({
            recipientEmail: email,
            error: this.formatError(error),
          });
        }
      }
    }

    return { targets: Array.from(targets.values()), failures };
  }

  private addHydratedConversationTarget(
    targets: Map<string, ReminderTarget>,
    conversation: HydratedConversation,
  ): void {
    const name = conversation.name ?? conversation.peer?.displayName ?? null;
    if (targets.has(conversation.id)) return;

    targets.set(conversation.id, {
      conversationId: conversation.id,
      conversationType: conversation.type,
      conversationName: name,
      recipientUserId:
        conversation.type === 'dm' ? conversation.peer?.id : undefined,
      recipientEmail:
        conversation.type === 'dm' ? conversation.peer?.email : undefined,
      recipientName:
        conversation.type === 'dm' ? conversation.peer?.displayName : undefined,
    });
  }

  private async addConversationTarget(
    targets: Map<string, ReminderTarget>,
    conversation: { id: string; type: ConversationType; name?: string | null },
    requesterId: string,
    overrides?: {
      recipientUserId?: string;
      recipientEmail?: string;
      recipientName?: string | null;
    },
  ): Promise<void> {
    if (targets.has(conversation.id)) return;

    let recipientUserId = overrides?.recipientUserId;
    let recipientEmail = overrides?.recipientEmail;
    let recipientName = overrides?.recipientName ?? null;

    if (conversation.type === 'dm' && !recipientUserId) {
      const memberIds = await this.conversationService.getMemberUserIds(
        conversation.id,
      );
      const otherId = memberIds.find((id) => id !== requesterId);
      if (otherId) {
        recipientUserId = otherId;
      }
    }

    if (recipientUserId && !recipientName) {
      const user = await this.userRepository.findOne({
        where: { id: recipientUserId },
      });
      recipientName = user ? effectiveDisplayName(user) : null;
      if (!recipientEmail) {
        recipientEmail = user?.email;
      }
    }

    targets.set(conversation.id, {
      conversationId: conversation.id,
      conversationType: conversation.type,
      conversationName: conversation.name ?? null,
      recipientUserId,
      recipientEmail,
      recipientName,
    });
  }

  private parseScheduledTime(
    scheduledAt: string | undefined,
    timezone: string,
  ): Date {
    const now = new Date();
    if (!scheduledAt) {
      // Default: 1 hour from now
      return new Date(now.getTime() + 60 * 60 * 1000);
    }

    const trimmed = scheduledAt.trim();
    const hasZone = /([zZ]|[+-]\d{2}:\d{2})$/.test(trimmed);

    let date: Date | null = null;
    if (hasZone) {
      date = new Date(trimmed);
    } else {
      date = this.parseInTimeZone(trimmed, timezone) ?? new Date(trimmed);
    }

    if (!date || isNaN(date.getTime())) {
      // Fallback: 1 hour from now
      this.logger.warn(
        `Invalid scheduledAt "${scheduledAt}", defaulting to +1h`,
      );
      return new Date(now.getTime() + 60 * 60 * 1000);
    }

    if (date.getTime() <= now.getTime()) {
      // Guard against reminders that would fire immediately due to parse drift.
      this.logger.warn(
        `Scheduled time "${scheduledAt}" was in the past; bumping +2m`,
      );
      return new Date(now.getTime() + 2 * 60 * 1000);
    }

    return date;
  }

  private parseInTimeZone(input: string, timezone: string): Date | null {
    const parts = this.parseDateParts(input);
    if (!parts) return null;

    const utcGuess = new Date(
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      ),
    );

    try {
      const offsetMs = this.getTimeZoneOffsetMs(timezone, utcGuess);
      const utcMs = utcGuess.getTime() - offsetMs;
      return new Date(utcMs);
    } catch (error) {
      this.logger.warn(
        `Invalid timezone "${timezone}" for scheduledAt "${input}": ${this.formatError(error)}`,
      );
      return null;
    }
  }

  private parseDateParts(input: string): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  } | null {
    const match = input.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2})(?::(\d{2}))?(?::(\d{2}))?)?/,
    );
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4] ?? 0);
    const minute = Number(match[5] ?? 0);
    const second = Number(match[6] ?? 0);

    if (
      Number.isNaN(year) ||
      Number.isNaN(month) ||
      Number.isNaN(day) ||
      Number.isNaN(hour) ||
      Number.isNaN(minute) ||
      Number.isNaN(second)
    ) {
      return null;
    }

    return { year, month, day, hour, minute, second };
  }

  private getTimeZoneOffsetMs(timezone: string, date: Date): number {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = dtf.formatToParts(date);
    const lookup = new Map(parts.map((p) => [p.type, p.value]));
    const year = Number(lookup.get('year'));
    const month = Number(lookup.get('month'));
    const day = Number(lookup.get('day'));
    const hour = Number(lookup.get('hour'));
    const minute = Number(lookup.get('minute'));
    const second = Number(lookup.get('second'));

    const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    return asUtc - date.getTime();
  }

  private toStringList(input: unknown, lower = false): string[] | undefined {
    if (!Array.isArray(input)) return undefined;
    const cleaned = input
      .filter((value): value is string => typeof value === 'string')
      .map((value) => (lower ? value.trim().toLowerCase() : value.trim()))
      .filter((value) => value.length > 0);
    if (cleaned.length === 0) return undefined;
    return Array.from(new Set(cleaned));
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}
