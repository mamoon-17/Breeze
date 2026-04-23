import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  /**
   * Emails to invite. Each one must belong to an existing Breeze user
   * (frontend validates via the user lookup endpoint first). The creator
   * is an immediate member; everyone else becomes a pending invitation.
   */
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  @IsOptional()
  memberEmails?: string[];

  @IsOptional()
  @IsUrl()
  avatarUrl?: string;
}
