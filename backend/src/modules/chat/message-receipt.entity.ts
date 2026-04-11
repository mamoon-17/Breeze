import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ChatMessage } from './chat-message.entity';

@Entity('message_receipts')
@Index(['messageId', 'userId'], { unique: true })
export class MessageReceipt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  messageId: string;

  /** Recipient user (not the sender); one row per recipient per message. */
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @ManyToOne(() => ChatMessage, (msg) => msg.receipts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'messageId' })
  message: ChatMessage;
}
