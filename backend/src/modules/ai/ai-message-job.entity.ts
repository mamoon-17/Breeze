import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AiMessageJobStatus = 'queued' | 'processing' | 'sent' | 'failed';

export interface AiMessageJobRecipients {
  allConversations?: boolean;
  userIds?: string[];
  emails?: string[];
  conversationIds?: string[];
  conversationNames?: string[];
}

export interface AiMessageJobOptions {
  contextMessageLimit?: number;
}

export interface AiMessageJobResult {
  conversationId?: string;
  conversationName?: string | null;
  recipientUserId?: string;
  recipientEmail?: string;
  draft?: string;
  messageId?: string;
  error?: string;
}

@Entity('ai_message_jobs')
export class AiMessageJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  requesterId: string;

  @Column({ type: 'text' })
  instruction: string;

  @Column({ type: 'jsonb' })
  recipients: AiMessageJobRecipients;

  @Column({ type: 'jsonb', nullable: true })
  options: AiMessageJobOptions | null;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  status: AiMessageJobStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'jsonb', nullable: true })
  results: AiMessageJobResult[] | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
