import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class ZenChatMessageDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsOptional()
  @IsIn(['chat', 'status', 'reminder_confirm'])
  kind?: 'chat' | 'status' | 'reminder_confirm';

  @IsString()
  @MaxLength(8000)
  content: string;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}

export class ZenPatchZenMessageDto {
  @IsObject()
  metaPatch: Record<string, unknown>;
}

