import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MessageReceipt } from './message-receipt.entity';
import { ChatMessageAttachment } from './chat-message-attachment.entity';

@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  room: string;

  @Index()
  @Column({ type: 'uuid' })
  senderId: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'text', nullable: true })
  attachmentUrl?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  attachmentType?: string | null;

  /** 'user' for normal messages, 'system' for call events etc. */
  @Column({ type: 'varchar', length: 16, default: 'user' })
  messageType: string;

  /** Sub-classification for system messages, e.g. 'call'. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  subtype?: string | null;

  /** Arbitrary JSON payload for system messages (call metadata, etc.). */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  /** Server accepted and stored the message (single tick / “sent”). Mirrors persist time. */
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  sentAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  @OneToMany(() => MessageReceipt, (r) => r.message)
  receipts: MessageReceipt[];

  @OneToMany(() => ChatMessageAttachment, (a) => a.message)
  attachments: ChatMessageAttachment[];
}
