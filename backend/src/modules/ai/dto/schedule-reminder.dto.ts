import { IsString, MaxLength, IsOptional } from 'class-validator';

export class CreateReminderDto {
  @IsString()
  @MaxLength(2000)
  instruction: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export interface ReminderParseResult {
  jobId: string;
  status: string;
  confirmationText: string;
  messageBody: string;
  scheduledAt: string;
  recipients: {
    allConversations?: boolean;
    conversationNames?: string[];
    emails?: string[];
  };
}

export interface ReminderJobResponse {
  id: string;
  status: string;
  instruction: string;
  messageBody: string;
  scheduledAt: string;
  timezone: string;
  confirmationText: string;
  recipients: {
    allConversations?: boolean;
    conversationNames?: string[];
    emails?: string[];
  };
  errorMessage: string | null;
  results: Array<{
    conversationId?: string;
    conversationName?: string | null;
    recipientUserId?: string;
    recipientEmail?: string;
    draft?: string;
    messageId?: string;
    error?: string;
  }> | null;
  createdAt: string;
}
