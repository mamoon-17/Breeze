import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class InvitationIdParamDto {
  @IsUUID()
  @IsString()
  @IsNotEmpty()
  id: string;
}
