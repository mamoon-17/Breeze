import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class ConversationIdParamDto {
  @IsUUID()
  @IsString()
  @IsNotEmpty()
  id: string;
}
