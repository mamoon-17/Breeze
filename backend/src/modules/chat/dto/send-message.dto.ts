import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  ValidateIf,
} from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  room: string;

  @IsString()
  @ValidateIf((o: SendMessageDto) => !o.attachmentUrl)
  @IsNotEmpty()
  message?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  attachmentUrl?: string;

  @ValidateIf((o: SendMessageDto) => Boolean(o.attachmentUrl))
  @IsString()
  @IsIn(['audio'])
  attachmentType?: 'audio';
}