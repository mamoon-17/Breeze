import { IsNotEmpty, IsString } from 'class-validator';

export class FamilyIdParamDto {
  @IsString()
  @IsNotEmpty()
  familyId: string;
}
