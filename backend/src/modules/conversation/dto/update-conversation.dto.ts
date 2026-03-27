import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsUrl()
  avatarUrl?: string;
}
