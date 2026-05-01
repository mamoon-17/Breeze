import {
  IsIn,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

class AttachmentDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsIn(['image', 'video', 'audio', 'file'])
  type: 'image' | 'video' | 'audio' | 'file';

  @IsString()
  @IsNotEmpty()
  mime: string;

  @IsNumber()
  size: number;

  @IsOptional()
  @IsString()
  filename?: string;
}

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  room: string;

  @IsString()
  @ValidateIf((o: SendMessageDto) => !o.attachmentUrl && !o.attachments?.length)
  @IsNotEmpty()
  message?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  attachmentUrl?: string;

  @ValidateIf((o: SendMessageDto) => Boolean(o.attachmentUrl))
  @IsString()
  @IsIn(['audio'])
  attachmentType?: 'audio';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];
}