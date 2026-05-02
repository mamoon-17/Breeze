import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';

export class SummariseChatDto {
  @IsString()
  conversationId: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(30)
  messageLimit?: number;
}

export interface SummaryResult {
  summary: string;
  bulletPoints: string[];
  participants: string[];
  dateRange: { from: string; to: string };
}
