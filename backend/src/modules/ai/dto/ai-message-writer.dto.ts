import {
  ArrayMaxSize,
  IsBoolean,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AiMessageWriterDto {
  @IsString()
  @MaxLength(2000)
  instruction!: string;

  @IsOptional()
  @IsBoolean()
  allConversations?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsUUID('4', { each: true })
  recipientUserIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsEmail({}, { each: true })
  recipientEmails?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsUUID('4', { each: true })
  conversationIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  conversationNames?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  contextMessageLimit?: number;
}
