import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('refresh_sessions')
export class RefreshSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Index()
  @Column({ type: 'uuid' })
  familyId: string;

  @Column({ type: 'varchar', length: 128 })
  tokenHash: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  currentAccessTokenJti: string | null;

  @Index()
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Index()
  @Column({ type: 'timestamptz' })
  absoluteExpiresAt: Date;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  replacedBySessionId?: string;

  @Column({ type: 'timestamptz', nullable: true })
  rotatedAt?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
