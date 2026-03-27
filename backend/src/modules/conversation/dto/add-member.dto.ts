import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class AddMemberDto {
  @IsUUID()
  @IsString()
  @IsNotEmpty()
  userId: string;
}
