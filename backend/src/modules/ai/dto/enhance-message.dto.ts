import { IsString, IsIn, IsOptional, MaxLength } from 'class-validator';

const MOOD_KEYS = [
  'neutral',
  'formal',
  'casual',
  'friendly',
  'creative',
  'funny',
  'empathetic',
  'assertive',
] as const;

type MoodKey = (typeof MOOD_KEYS)[number];

export class EnhanceMessageDto {
  @IsString()
  @MaxLength(2000)
  originalText: string;

  @IsIn([...MOOD_KEYS])
  moodKey: MoodKey;

  @IsOptional()
  @IsString()
  conversationId?: string;
}

