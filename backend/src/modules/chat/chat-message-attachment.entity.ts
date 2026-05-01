import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ChatMessage } from './chat-message.entity';

export type ChatAttachmentType = 'image' | 'video' | 'audio' | 'file';

@Entity('chat_message_attachments')
export class ChatMessageAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  messageId: string;

  @ManyToOne(() => ChatMessage, (m) => m.attachments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'messageId' })
  message: ChatMessage;

  @Column({ type: 'varchar', length: 16 })
  type: ChatAttachmentType;

  /** S3 object key (private). */
  @Column({ type: 'text' })
  key: string;

  @Column({ type: 'varchar', length: 128 })
  mime: string;

  @Column({ type: 'bigint' })
  size: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  filename?: string | null;

  @Column({ type: 'int', nullable: true })
  width?: number | null;

  @Column({ type: 'int', nullable: true })
  height?: number | null;

  @Column({ type: 'int', nullable: true })
  durationMs?: number | null;

  @CreateDateColumn()
  createdAt: Date;
}

