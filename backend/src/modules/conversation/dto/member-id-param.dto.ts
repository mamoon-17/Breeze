import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class MemberIdParamDto {
  @IsUUID()
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsString()
  @IsNotEmpty()
  userId: string;
}
