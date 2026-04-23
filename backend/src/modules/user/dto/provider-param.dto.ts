import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class ProviderParamDto {
  @IsIn(['google'])
  provider: 'google';

  @IsString()
  @IsNotEmpty()
  providerId: string;
}
