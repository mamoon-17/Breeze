import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class MarkDeliveredDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  messageIds: string[];
}
