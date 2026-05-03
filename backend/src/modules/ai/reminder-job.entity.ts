import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { AiMessageJobRecipients, AiMessageJobResult } from './ai-message-job.entity';

export type ReminderJobStatus =
  | 'pending_confirmation'
  | 'scheduled'
  | 'sent'
  | 'failed'
  | 'cancelled';

@Entity('reminder_jobs')
export class ReminderJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  requesterId: string;

  @Column({ type: 'text' })
  instruction: string;

  @Column({ type: 'text' })
  messageBody: string;

  @Column({ type: 'jsonb' })
  recipients: AiMessageJobRecipients;

  @Column({ type: 'timestamptz' })
  scheduledAt: Date;

  @Column({ type: 'varchar', length: 64 })
  timezone: string;

  @Column({ type: 'text' })
  confirmationText: string;

  @Column({ type: 'varchar', length: 25, default: 'pending_confirmation' })
  status: ReminderJobStatus;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'jsonb', nullable: true })
  results: AiMessageJobResult[] | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
