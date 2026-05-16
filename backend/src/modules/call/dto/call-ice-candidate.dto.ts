import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CallIceCandidateDto {
  @IsUUID()
  @IsNotEmpty()
  callId: string;

  @IsString()
  @IsNotEmpty()
  candidate: string; // JSON-stringified RTCIceCandidate
}
