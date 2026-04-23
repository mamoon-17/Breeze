import { IsEmail, IsNotEmpty } from 'class-validator';

/**
 * Start a DM by email. Email is the only supported identifier — user IDs
 * never leak to the UI, and the invitation-free DM flow only needs a mail.
 */
export class CreateDmDto {
  @IsEmail()
  @IsNotEmpty()
  targetEmail: string;
}
