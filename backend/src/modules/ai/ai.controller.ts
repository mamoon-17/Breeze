import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';
import { EnhanceMessageDto } from './dto/enhance-message.dto';
import { AiChatDto } from './dto/chat-message.dto';
import { moodSystemPrompt } from './prompts/mood.prompts';

const BREEZE_ASSISTANT_SYSTEM = `You are Breeze Assistant, a helpful AI inside a chat app. You help users rephrase messages, suggest replies, and improve their communication. Be concise.`;

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(private readonly aiService: AiService) {}

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
}
