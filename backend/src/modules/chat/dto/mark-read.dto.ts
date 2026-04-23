import { IsUUID } from 'class-validator';

export class MarkReadDto {
  @IsUUID()
  conversationId: string;

  /** Marks this message and all older messages in the conversation as read (for the current user). */
  @IsUUID()
  readUpToMessageId: string;
}
