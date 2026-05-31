import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import OpenAI from 'openai';
import { ChatMessage } from '../chat/chat-message.entity';
import { User } from '../user/user.entity';
import { ConversationService } from '../conversation/conversation.service';
import { effectiveDisplayName } from '../user/user-projection';
import { summarySystemPrompt } from './prompts/summary.prompts';
import { SummaryResult } from './dto/summarise-chat.dto';
import { AiUserMemory } from './ai-user-memory.entity';
import {
  buildMemoryExtractionUserPrompt,
  memoryExtractionSystemPrompt,
} from './prompts/memory.prompts';
import { AiZenChatMessage } from './ai-zen-chat-message.entity';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI;
  private readonly model: string;
  /** Avoid duplicate background memory rebuilds for the same user. */
  private readonly memoryRefreshInFlight = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AiUserMemory)
    private readonly aiUserMemoryRepository: Repository<AiUserMemory>,
    @InjectRepository(AiZenChatMessage)
    private readonly aiZenChatRepository: Repository<AiZenChatMessage>,
    private readonly conversationService: ConversationService,
  ) {
    const apiKey = process.env.GITHUB_MODEL_KEY;
    if (!apiKey) {
      this.logger.warn(
        'GITHUB_MODEL_KEY not set — AI features will fail at runtime',
      );
    }

    this.model = process.env.AI_MODEL || 'gpt-4.1-mini';
    const baseURL =
      process.env.AI_BASE_URL || 'https://models.github.ai/inference';

    this.client = new OpenAI({
      apiKey,
      baseURL,
      // Stay under typical reverse-proxy limits (e.g. Render ~30s) so retries can run.
      timeout: 25_000,
      maxRetries: 0,
    });
  }

  private assertAiConfigured(): void {
    if (!process.env.GITHUB_MODEL_KEY?.trim()) {
      throw new ServiceUnavailableException(
        'AI is not configured. Set GITHUB_MODEL_KEY on the server.',
      );
    }
  }

  /**
   * Simple system + user prompt completion.
   * Used by the mood enhancer.
   */
  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    this.assertAiConfigured();
    const response = await this.withRetry(() =>
      this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 1024,
      }),
    );

    return response.choices[0]?.message?.content?.trim() ?? '';
  }

  /**
   * Multi-turn chat completion.
   * Used by the AI chat sidebar.
   */
  async chat(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  ): Promise<string> {
    this.assertAiConfigured();
    const response = await this.withRetry(() =>
      this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    );

    return response.choices[0]?.message?.content?.trim() ?? '';
  }

  /**
   * Returns a concise cross-chat memory for the user (may be empty).
   * The memory is periodically rebuilt from the user's most recent messages
   * across *all* conversations, so it persists across chats and devices.
   */
  async getUserMemory(userId: string): Promise<string> {
    const existing = await this.aiUserMemoryRepository.findOne({
      where: { userId },
    });

    if (!this.isUserMemoryStale(existing)) {
      return existing?.memory?.trim() ?? '';
    }

    return this.rebuildAndPersistUserMemory(userId, existing?.memory ?? '', existing);
  }

  /**
   * Fast path for /ai/chat — never blocks on a memory rebuild (which is an
   * extra LLM call and often pushes the request over Render's HTTP timeout).
   */
  async getUserMemoryForChat(userId: string): Promise<string> {
    const existing = await this.aiUserMemoryRepository.findOne({
      where: { userId },
    });
    const memory = existing?.memory?.trim() ?? '';

    if (this.isUserMemoryStale(existing)) {
      this.scheduleUserMemoryRefresh(userId, existing);
    }

    return memory;
  }

  private isUserMemoryStale(existing: AiUserMemory | null): boolean {
    const staleAfterMs = 6 * 60 * 60 * 1000;
    return (
      !existing?.updatedAt ||
      Date.now() - existing.updatedAt.getTime() > staleAfterMs
    );
  }

  private scheduleUserMemoryRefresh(
    userId: string,
    existing: AiUserMemory | null,
  ): void {
    if (this.memoryRefreshInFlight.has(userId)) return;

    const job = this.rebuildAndPersistUserMemory(
      userId,
      existing?.memory ?? '',
      existing,
    )
      .then(() => undefined)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Background memory refresh failed for ${userId}: ${msg}`);
      })
      .finally(() => {
        this.memoryRefreshInFlight.delete(userId);
      });

    this.memoryRefreshInFlight.set(userId, job);
  }

  private async rebuildAndPersistUserMemory(
    userId: string,
    existingMemory: string,
    existing: AiUserMemory | null,
  ): Promise<string> {
    const rebuilt = await this.rebuildUserMemoryFromChats(
      userId,
      existingMemory,
    );

    let row =
      existing ??
      (await this.aiUserMemoryRepository.findOne({ where: { userId } }));

    if (!row) {
      row = this.aiUserMemoryRepository.create({
        userId,
        memory: rebuilt,
      });
      await this.aiUserMemoryRepository.save(row);
    } else {
      row.memory = rebuilt;
      await this.aiUserMemoryRepository.save(row);
    }

    return rebuilt.trim();
  }

  private async rebuildUserMemoryFromChats(
    userId: string,
    existingMemory: string,
  ): Promise<string> {
    // Only use the user's own messages as evidence (privacy + correctness).
    const recent = await this.chatMessageRepository.find({
      where: { senderId: userId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
      take: 200,
    });

    // Oldest-first transcript.
    const transcript = [...recent]
      .reverse()
      .map((m) => `[${m.createdAt.toISOString()}] ${m.message}`)
      .join('\n');

    if (!transcript.trim()) return '';

    const raw = await this.complete(
      memoryExtractionSystemPrompt,
      buildMemoryExtractionUserPrompt({
        existingMemory: existingMemory ?? '',
        recentUserMessages: transcript,
      }),
    );

    // Ensure we only store plain text.
    const cleaned = (raw ?? '')
      .replace(/```[\s\S]*?```/g, '')
      .trim();

    // Hard cap to avoid runaway prompts.
    return cleaned.slice(0, 4000);
  }

  private async withRetry<T>(
    fn: () => Promise<T>,
    maxAttempts = 3,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (!this.isRetryableAiError(err) || attempt === maxAttempts) {
          throw err;
        }
        const delayMs = 400 * attempt;
        this.logger.warn(
          `AI request failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError;
  }

  private isRetryableAiError(err: unknown): boolean {
    if (err instanceof OpenAI.APIError) {
      return (
        err.status === 408 ||
        err.status === 429 ||
        err.status === 502 ||
        err.status === 503 ||
        err.status === 504
      );
    }
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';
    return (
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND'
    );
  }

  // ─── Zen AI persisted chat history ─────────────────────────────────────────

  async getZenChatHistory(
    userId: string,
    limit = 200,
  ): Promise<
    {
      id: string;
      role: 'user' | 'assistant';
      kind: 'chat' | 'status' | 'reminder_confirm';
      content: string;
      meta: Record<string, unknown> | null;
    }[]
  > {
    const n = Math.max(1, Math.min(500, limit));
    const rows = await this.aiZenChatRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: n,
    });
    return [...rows]
      .reverse()
      .map((r) => ({
        id: r.id,
        role: r.role,
        kind: r.kind ?? 'chat',
        content: r.content,
        meta: r.meta ?? null,
      }));
  }

  async appendZenChatMessage(
    userId: string,
    role: 'user' | 'assistant',
    content: string,
    kind: 'chat' | 'status' | 'reminder_confirm' = 'chat',
    meta?: Record<string, unknown> | null,
  ): Promise<{ id: string }> {
    const trimmed = (content ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('Zen chat content cannot be empty');
    }

    const row = this.aiZenChatRepository.create({
      userId,
      role,
      kind,
      content: trimmed.slice(0, 8000),
      meta: meta ?? null,
    });
    const saved = await this.aiZenChatRepository.save(row);
    return { id: saved.id };
  }

  async patchZenChatMessageMeta(
    userId: string,
    messageId: string,
    metaPatch: Record<string, unknown>,
  ): Promise<void> {
    const row = await this.aiZenChatRepository.findOne({
      where: { id: messageId, userId },
    });
    if (!row) {
      throw new NotFoundException('Zen chat message not found');
    }
    row.meta = { ...(row.meta ?? {}), ...metaPatch };
    await this.aiZenChatRepository.save(row);
  }

  async clearZenChatHistory(userId: string): Promise<void> {
    await this.aiZenChatRepository.delete({ userId });
  }

  /**
   * Summarises the last N messages of a conversation.
   * Verifies the requesting user is a member before fetching.
   */
  async summariseChat(
    conversationId: string,
    messageLimit = 20,
    userId: string,
  ): Promise<SummaryResult> {
    // Gate: requester must be a member of the conversation
    await this.conversationService.requireMember(userId, conversationId);

    // Fetch last N non-deleted messages, newest-first
    const messages = await this.chatMessageRepository.find({
      where: { room: conversationId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
      take: messageLimit,
    });

    // Reverse to oldest-first for the transcript
    const sorted = [...messages].reverse();

    // Resolve sender display names in one query
    const senderIds = [...new Set(sorted.map((m) => m.senderId))];
    const users =
      senderIds.length > 0
        ? await this.userRepository.find({ where: { id: In(senderIds) } })
        : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    // Build plain-text transcript: "[ISO] SenderName: message"
    const transcript = sorted
      .map((m) => {
        const u = userById.get(m.senderId);
        const name = u ? effectiveDisplayName(u) : m.senderId;
        return `[${m.createdAt.toISOString()}] ${name}: ${m.message}`;
      })
      .join('\n');

    // Call the LLM
    const raw = await this.complete(summarySystemPrompt, transcript);

    // Parse and validate JSON
    try {
      return JSON.parse(raw) as SummaryResult;
    } catch {
      this.logger.error('AI summary parse error — raw response:', raw);
      throw new InternalServerErrorException(
        'AI returned invalid summary format',
      );
    }
  }
}
