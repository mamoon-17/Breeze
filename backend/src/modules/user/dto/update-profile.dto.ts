import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  /**
   * The user's preferred display name. Send `null` or an empty string to
   * clear the override and fall back to the Google-supplied name.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  customDisplayName?: string | null;

  /** Whether to serve the Google picture (true) or the custom upload (false). */
  @IsOptional()
  @IsBoolean()
  useGoogleAvatar?: boolean;
}
