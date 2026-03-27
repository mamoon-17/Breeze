import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Membership } from './membership.entity';

export type ConversationType = 'dm' | 'group';

@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 10 })
  type: ConversationType;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string | null;

  @Column({ type: 'text', nullable: true })
  avatarUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => Membership, (membership) => membership.conversation)
  memberships: Membership[];
}
