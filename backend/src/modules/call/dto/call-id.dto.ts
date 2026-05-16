import { IsNotEmpty, IsUUID } from 'class-validator';

export class CallIdDto {
  @IsUUID()
  @IsNotEmpty()
  callId: string;
}
