import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'A group requires at least one other member' })
  @ArrayUnique()
  @IsUUID('all', { each: true })
  memberIds: string[];

  @IsOptional()
  @IsUrl()
  avatarUrl?: string;
}
