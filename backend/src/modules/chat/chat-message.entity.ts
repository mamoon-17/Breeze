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

  /** Server accepted and stored the message (single tick / “sent”). Mirrors persist time. */
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  sentAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  @OneToMany(() => MessageReceipt, (r) => r.message)
  receipts: MessageReceipt[];
}
