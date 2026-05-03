import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Interval } from '@nestjs/schedule';
import { In, IsNull, Repository } from 'typeorm';
import { AiService } from './ai.service';
import {
  AiMessageJob,
  AiMessageJobOptions,
  AiMessageJobRecipients,
  AiMessageJobResult,
  AiMessageJobStatus,
} from './ai-message-job.entity';
import { AiMessageWriterDto } from './dto/ai-message-writer.dto';
import { ConversationService } from '../conversation/conversation.service';
import type { HydratedConversation } from '../conversation/conversation.service';
import { ChatService } from '../chat/chat.service';
import { ChatMessage } from '../chat/chat-message.entity';
import { User } from '../user/user.entity';
import { effectiveDisplayName } from '../user/user-projection';
import {
  buildMessageWriterUserPrompt,
  messageWriterSystemPrompt,
} from './prompts/message-writer.prompts';
import { SendMessageDto } from '../chat/dto/send-message.dto';
import type { ConversationType } from '../conversation/conversation.entity';

interface MessageTarget {
  conversationId: string;
  conversationType: ConversationType;
  conversationName: string | null;
  recipientUserId?: string;
  recipientEmail?: string;
  recipientName?: string | null;
}

@Injectable()
export class AiMessageWriterService {
  private readonly logger = new Logger(AiMessageWriterService.name);
  private readonly defaultContextLimit = 6;
  private readonly batchSize = 3;

  constructor(
    private readonly aiService: AiService,
    private readonly conversationService: ConversationService,
    private readonly chatService: ChatService,
    @InjectRepository(AiMessageJob)
    private readonly jobRepository: Repository<AiMessageJob>,
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async createJob(
    dto: AiMessageWriterDto,
    requesterId: string,
  ): Promise<AiMessageJob> {
    const instruction = dto.instruction.trim();
    if (!instruction) {
      throw new BadRequestException('Instruction cannot be empty');
    }

    const recipients = this.normalizeRecipients(dto);
    const options = this.normalizeOptions(dto);

    const job = this.jobRepository.create({
      requesterId,
      instruction,
      recipients,
      options,
      status: 'queued',
      attempts: 0,
      errorMessage: null,
      results: null,
      startedAt: null,
      completedAt: null,
    });

    return this.jobRepository.save(job);
  }

  async getJob(jobId: string, requesterId: string): Promise<AiMessageJob> {
    const job = await this.jobRepository.findOne({
      where: { id: jobId, requesterId },
    });
    if (!job) {
      throw new NotFoundException('Message job not found');
    }
    return job;
  }

  @Interval(5000)
  async processQueuedJobs(): Promise<void> {
    const jobs = await this.jobRepository.find({
      where: { status: 'queued' },
      order: { createdAt: 'ASC' },
      take: this.batchSize,
    });

    if (jobs.length === 0) return;

    for (const job of jobs) {
      await this.processJob(job);
    }
  }

  private normalizeRecipients(dto: AiMessageWriterDto): AiMessageJobRecipients {
    const toCleanList = (
      values?: string[],
      lower = false,
    ): string[] | undefined => {
      const cleaned = (values ?? [])
        .map((value) => (lower ? value.trim().toLowerCase() : value.trim()))
        .filter((value) => value.length > 0);

      if (cleaned.length === 0) return undefined;
      return Array.from(new Set(cleaned));
    };

    const recipients: AiMessageJobRecipients = {
      allConversations: Boolean(dto.allConversations),
      userIds: toCleanList(dto.recipientUserIds),
      emails: toCleanList(dto.recipientEmails, true),
      conversationIds: toCleanList(dto.conversationIds),
      conversationNames: toCleanList(dto.conversationNames),
    };

    const hasRecipients =
      (recipients.allConversations ? 1 : 0) +
        (recipients.userIds?.length ?? 0) +
        (recipients.emails?.length ?? 0) +
        (recipients.conversationIds?.length ?? 0) +
        (recipients.conversationNames?.length ?? 0) >
      0;

    if (!hasRecipients) {
      throw new BadRequestException('At least one recipient is required');
    }

    return recipients;
  }

  private normalizeOptions(
    dto: AiMessageWriterDto,
  ): AiMessageJobOptions | null {
    if (dto.contextMessageLimit === undefined) return null;
    return { contextMessageLimit: dto.contextMessageLimit };
  }

  private async processJob(job: AiMessageJob): Promise<void> {
    const locked = await this.jobRepository
      .createQueryBuilder()
      .update(AiMessageJob)
      .set({
        status: 'processing',
        startedAt: new Date(),
        attempts: () => '"attempts" + 1',
      })
      .where('id = :id', { id: job.id })
      .andWhere('status = :status', { status: 'queued' })
      .execute();

    if ((locked.affected ?? 0) === 0) return;

    const results: AiMessageJobResult[] = [];

    try {
      const requester = await this.userRepository.findOne({
        where: { id: job.requesterId },
      });
      const senderName = requester ? effectiveDisplayName(requester) : 'Sender';

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
          const draft = await this.generateDraft(job, target, senderName);
          const dto: SendMessageDto = {
            room: target.conversationId,
            message: draft,
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
            draft,
            messageId: message.id,
          });
          successCount += 1;
        } catch (error) {
          const errorMessage = this.formatError(error);
          this.logger.error(
            `Message writer failed for conversation ${target.conversationId}: ${errorMessage}`,
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

      const status: AiMessageJobStatus = successCount > 0 ? 'sent' : 'failed';
      const errorMessage =
        successCount === 0
          ? 'All targets failed'
          : results.some((r) => r.error)
            ? 'Some targets failed'
            : null;

      await this.finalizeJob(job.id, status, results, errorMessage);
    } catch (error) {
      const errorMessage = this.formatError(error);
      this.logger.error(`Message writer job ${job.id} failed: ${errorMessage}`);
      await this.finalizeJob(job.id, 'failed', results, errorMessage);
    }
  }

  private async finalizeJob(
    jobId: string,
    status: AiMessageJobStatus,
    results: AiMessageJobResult[],
    errorMessage: string | null,
  ): Promise<void> {
    await this.jobRepository.update(
      { id: jobId },
      {
        status,
        results: results.length > 0 ? results : null,
        errorMessage,
        completedAt: new Date(),
      },
    );
  }

  private async resolveTargets(job: AiMessageJob): Promise<{
    targets: MessageTarget[];
    failures: AiMessageJobResult[];
  }> {
    const targets = new Map<string, MessageTarget>();
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
        await this.addHydratedConversationTarget(
          targets,
          conversation,
          job.requesterId,
        );
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
          await this.addHydratedConversationTarget(
            targets,
            match,
            job.requesterId,
          );
        }
      }
    }

    if (recipients.userIds?.length) {
      for (const userId of recipients.userIds) {
        try {
          const conversation = await this.conversationService.getOrCreateDm(
            job.requesterId,
            userId,
          );
          const user = await this.userRepository.findOne({
            where: { id: userId },
          });
          await this.addConversationTarget(
            targets,
            conversation,
            job.requesterId,
            {
              recipientUserId: userId,
              recipientEmail: user?.email,
              recipientName: user ? effectiveDisplayName(user) : null,
            },
          );
        } catch (error) {
          failures.push({
            recipientUserId: userId,
            error: this.formatError(error),
          });
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

  private async addHydratedConversationTarget(
    targets: Map<string, MessageTarget>,
    conversation: HydratedConversation,
    requesterId: string,
  ): Promise<void> {
    const name = conversation.name ?? conversation.peer?.displayName ?? null;
    const overrides =
      conversation.type === 'dm' && conversation.peer
        ? {
            recipientUserId: conversation.peer.id,
            recipientEmail: conversation.peer.email,
            recipientName: conversation.peer.displayName,
          }
        : undefined;

    await this.addConversationTarget(
      targets,
      {
        id: conversation.id,
        type: conversation.type,
        name,
      },
      requesterId,
      overrides,
    );
  }

  private async addConversationTarget(
    targets: Map<string, MessageTarget>,
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

  private async generateDraft(
    job: AiMessageJob,
    target: MessageTarget,
    senderName: string,
  ): Promise<string> {
    const recipientName = this.pickRecipientName(target);
    const contextLimit =
      job.options?.contextMessageLimit ?? this.defaultContextLimit;
    const recentMessages = await this.buildRecentContext(
      target.conversationId,
      contextLimit,
    );

    const userPrompt = buildMessageWriterUserPrompt({
      instruction: job.instruction,
      senderName,
      recipientName,
      conversationName: target.conversationName ?? undefined,
      recentMessages,
    });

    const draft = await this.aiService.complete(
      messageWriterSystemPrompt,
      userPrompt,
    );

    const trimmed = draft.trim();
    if (!trimmed) {
      throw new Error('AI returned an empty message');
    }

    return trimmed;
  }

  private pickRecipientName(target: MessageTarget): string | null {
    if (target.conversationType === 'group') {
      return target.conversationName ?? 'everyone';
    }

    return target.recipientName ?? target.recipientEmail ?? 'there';
  }

  private async buildRecentContext(
    conversationId: string,
    limit: number,
  ): Promise<string | null> {
    const messageLimit = Math.max(0, Math.min(limit, 20));
    if (messageLimit === 0) return null;

    const messages = await this.chatMessageRepository.find({
      where: { room: conversationId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
      take: messageLimit,
    });

    if (messages.length === 0) return null;

    const sorted = [...messages].reverse();
    const senderIds = Array.from(new Set(sorted.map((m) => m.senderId)));
    const users =
      senderIds.length > 0
        ? await this.userRepository.find({ where: { id: In(senderIds) } })
        : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    return sorted
      .map((message) => {
        const sender = userById.get(message.senderId);
        const senderName = sender
          ? effectiveDisplayName(sender)
          : message.senderId;
        const text = this.normalizeMessageText(message.message);
        return `${senderName}: ${text}`;
      })
      .join('\n');
  }

  private normalizeMessageText(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 500) return normalized;
    return `${normalized.slice(0, 500).trim()}...`;
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}
