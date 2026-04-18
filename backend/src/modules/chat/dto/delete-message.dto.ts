import { IsUUID } from 'class-validator';

export class DeleteMessageDto {
  @IsUUID()
  room: string;

  @IsUUID()
  messageId: string;
}

