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

  @Column({ type: 'boolean', default: false })
  requiresStepUp: boolean;

  @Column({ type: 'varchar', length: 10, nullable: true })
  lastKnownCountry: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  lastKnownUserAgentHash: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgentRaw: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  ipPrefix: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
