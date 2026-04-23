import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';

export type InvitationStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'cancelled';

@Entity('conversation_invitations')
// Only one row per (conversation, invitee). On re-invite after reject/cancel,
// we simply upsert the row back to 'pending'.
@Index(['conversationId', 'inviteeId'], { unique: true })
export class ConversationInvitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  conversationId: string;

  @Index()
  @Column({ type: 'uuid' })
  inviterId: string;

  @Index()
  @Column({ type: 'uuid' })
  inviteeId: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: InvitationStatus;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @ManyToOne(() => Conversation, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversationId' })
  conversation: Conversation;
}
