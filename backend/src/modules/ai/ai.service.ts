import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
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

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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

    this.client = new OpenAI({ apiKey, baseURL });
  }

  /**
   * Simple system + user prompt completion.
   * Used by the mood enhancer.
   */
  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1024,
    });

    return response.choices[0]?.message?.content?.trim() ?? '';
  }

  /**
   * Multi-turn chat completion.
   * Used by the AI chat sidebar.
   */
  async chat(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
    });

    return response.choices[0]?.message?.content?.trim() ?? '';
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
