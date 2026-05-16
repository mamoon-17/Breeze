import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CallAnswerDto {
  @IsUUID()
  @IsNotEmpty()
  callId: string;

  @IsString()
  @IsNotEmpty()
  answer: string; // JSON-stringified RTCSessionDescription
}
