import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CallInitiateDto {
  @IsUUID()
  @IsNotEmpty()
  conversationId: string;

  @IsUUID()
  @IsNotEmpty()
  calleeId: string;

  @IsString()
  @IsNotEmpty()
  offer: string; // JSON-stringified RTCSessionDescription
}
