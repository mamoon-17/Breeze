import { IsString, IsOptional, MaxLength } from 'class-validator';

export class AiIntentDto {
  @IsString()
  @MaxLength(2000)
  text: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export interface AiIntentRecipients {
  allConversations?: boolean;
  conversationNames?: string[];
  emails?: string[];
}

export interface AiIntentResult {
  action: 'chat' | 'send_message' | 'schedule_reminder';
  instruction?: string;
  recipients?: AiIntentRecipients;
  scheduledTime?: string;
  messageBody?: string;
  confidence: number;
}
