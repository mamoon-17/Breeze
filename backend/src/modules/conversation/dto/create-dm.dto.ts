import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateDmDto {
  @IsUUID()
  @IsString()
  @IsNotEmpty()
  targetUserId: string;
}
