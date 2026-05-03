import { IsString, MaxLength } from 'class-validator';

export class AiIntentDto {
  @IsString()
  @MaxLength(2000)
  text: string;
}

export interface AiIntentRecipients {
  allConversations?: boolean;
  conversationNames?: string[];
  emails?: string[];
}

export interface AiIntentResult {
  action: 'chat' | 'send_message';
  instruction?: string;
  recipients?: AiIntentRecipients;
  confidence: number;
}
