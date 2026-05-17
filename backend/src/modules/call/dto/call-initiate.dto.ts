import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

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

  @IsOptional()
  @IsIn(['audio', 'video'])
  type?: 'audio' | 'video';
}
