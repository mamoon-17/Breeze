import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { CallOutcome } from './call.events';

@Entity('call_records')
export class CallRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  conversationId: string;

  @Index()
  @Column({ type: 'uuid' })
  callerId: string;

  @Index()
  @Column({ type: 'uuid' })
  calleeId: string;

  @Column({ type: 'varchar', length: 16, default: 'audio' })
  callType: 'audio' | 'video';

  @Column({ type: 'varchar', length: 16 })
  outcome: CallOutcome;

  /** Duration in seconds. Null when the call was never answered. */
  @Column({ type: 'int', nullable: true })
  durationSeconds: number | null;

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  answeredAt: Date | null;

  @Column({ type: 'timestamptz' })
  endedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
