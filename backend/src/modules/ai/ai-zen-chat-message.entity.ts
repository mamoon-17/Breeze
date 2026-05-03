import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('ai_zen_chat_messages')
export class AiZenChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 16 })
  role: 'user' | 'assistant';

  /** UI kind: normal chat bubble vs status line vs reminder confirmation card. */
  @Column({ type: 'varchar', length: 32, default: 'chat' })
  kind: 'chat' | 'status' | 'reminder_confirm';

  @Column({ type: 'text' })
  content: string;

  /** Optional structured payload (e.g. reminder card data). */
  @Column({ type: 'jsonb', nullable: true })
  meta?: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}

