import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor() {
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
}
