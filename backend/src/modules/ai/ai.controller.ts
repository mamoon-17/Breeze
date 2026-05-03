import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Logger,
  HttpException,
  HttpStatus,
  Get,
  Param,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';
import { EnhanceMessageDto } from './dto/enhance-message.dto';
import { AiChatDto } from './dto/chat-message.dto';
import { moodSystemPrompt } from './prompts/mood.prompts';
import { SummariseChatDto } from './dto/summarise-chat.dto';
import type { SummaryResult } from './dto/summarise-chat.dto';
import { AiMessageWriterService } from './ai-message-writer.service';
import { AiMessageWriterDto } from './dto/ai-message-writer.dto';
import { AiMessageJob } from './ai-message-job.entity';
import { AiIntentDto, AiIntentResult } from './dto/ai-intent.dto';
import {
  buildIntentUserPrompt,
  intentSystemPrompt,
} from './prompts/intent.prompts';

const BREEZE_ASSISTANT_SYSTEM = `You are Breeze Assistant, a helpful AI inside a chat app. You help users rephrase messages, suggest replies, and improve their communication. Be concise.`;

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly aiService: AiService,
    private readonly aiMessageWriterService: AiMessageWriterService,
  ) {}

  @Post('enhance')
  @UseGuards(JwtAuthGuard)
  async enhance(
    @Body() dto: EnhanceMessageDto,
    @Request() req: { user: { id: string } },
  ): Promise<{ enhancedText: string }> {
    this.logger.log(
      `User ${req.user.id} enhancing message with mood: ${dto.moodKey}`,
    );
    try {
      const result = await this.aiService.complete(
        moodSystemPrompt(dto.moodKey),
        dto.originalText,
      );
      return { enhancedText: result.trim() };
    } catch (error) {
      this.logger.error('AI enhance failed', error);
      throw new HttpException(
        'AI service temporarily unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Post('chat')
  @UseGuards(JwtAuthGuard)
  async chat(
    @Body() dto: AiChatDto,
    @Request() req: { user: { id: string } },
  ): Promise<{ reply: string }> {
    this.logger.log(
      `User ${req.user.id} AI chat — ${dto.messages.length} messages`,
    );
    try {
      // Prepend the system prompt so every conversation has the assistant context
      const messagesWithSystem: {
        role: 'system' | 'user' | 'assistant';
        content: string;
      }[] = [
        { role: 'system', content: BREEZE_ASSISTANT_SYSTEM },
        ...dto.messages,
      ];
      const reply = await this.aiService.chat(messagesWithSystem);
      return { reply };
    } catch (error) {
      this.logger.error('AI chat failed', error);
      throw new HttpException(
        'AI service temporarily unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Post('intent')
  @UseGuards(JwtAuthGuard)
  async intent(
    @Body() dto: AiIntentDto,
    @Request() req: { user: { id: string } },
  ): Promise<AiIntentResult> {
    this.logger.log(`User ${req.user.id} AI intent check`);
    try {
      const raw = await this.aiService.complete(
        intentSystemPrompt,
        buildIntentUserPrompt(dto.text),
      );
      return this.normalizeIntent(raw, dto.text);
    } catch (error) {
      this.logger.error('AI intent failed', error);
      return { action: 'chat', confidence: 0 };
    }
  }

  @Post('summarise')
  @UseGuards(JwtAuthGuard)
  async summarise(
    @Body() dto: SummariseChatDto,
    @Request() req: { user: { id: string } },
  ): Promise<SummaryResult> {
    this.logger.log(
      `User ${req.user.id} summarising conversation ${dto.conversationId} (limit: ${dto.messageLimit ?? 20})`,
    );
    return this.aiService.summariseChat(
      dto.conversationId,
      dto.messageLimit,
      req.user.id,
    );
  }

  @Post('message-writer')
  @UseGuards(JwtAuthGuard)
  async queueMessageWriter(
    @Body() dto: AiMessageWriterDto,
    @Request() req: { user: { id: string } },
  ): Promise<{ jobId: string; status: string }> {
    this.logger.log(`User ${req.user.id} queued AI message writer job`);
    const job = await this.aiMessageWriterService.createJob(dto, req.user.id);
    return { jobId: job.id, status: job.status };
  }

  @Get('message-writer/:jobId')
  @UseGuards(JwtAuthGuard)
  async getMessageWriterJob(
    @Param('jobId') jobId: string,
    @Request() req: { user: { id: string } },
  ): Promise<AiMessageJob> {
    return this.aiMessageWriterService.getJob(jobId, req.user.id);
  }

  private normalizeIntent(raw: string, fallbackText: string): AiIntentResult {
    try {
      const parsed = JSON.parse(raw) as Partial<AiIntentResult> & {
        recipients?: { [key: string]: unknown };
      };
      const action = parsed.action === 'send_message' ? 'send_message' : 'chat';
      const confidence = this.toConfidence(parsed.confidence);

      if (action === 'chat') {
        return { action, confidence };
      }

      const instruction =
        typeof parsed.instruction === 'string' && parsed.instruction.trim()
          ? parsed.instruction.trim()
          : fallbackText.trim();
      const recipients = parsed.recipients ?? {};
      const conversationNames = this.toStringList(recipients.conversationNames);
      const emails = this.toStringList(recipients.emails, true);
      const allConversations = Boolean(recipients.allConversations);

      if (
        !allConversations &&
        conversationNames.length === 0 &&
        emails.length === 0
      ) {
        return { action: 'chat', confidence: Math.min(confidence, 0.3) };
      }

      return {
        action,
        instruction,
        recipients: {
          allConversations,
          conversationNames,
          emails,
        },
        confidence,
      };
    } catch (error) {
      this.logger.error('AI intent parse error — raw response:', raw);
      return { action: 'chat', confidence: 0 };
    }
  }

  private toStringList(input: unknown, lower = false): string[] {
    if (!Array.isArray(input)) return [];
    const cleaned = input
      .filter((value): value is string => typeof value === 'string')
      .map((value) => (lower ? value.trim().toLowerCase() : value.trim()))
      .filter((value) => value.length > 0);
    return Array.from(new Set(cleaned));
  }

  private toConfidence(value: unknown): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }
}
