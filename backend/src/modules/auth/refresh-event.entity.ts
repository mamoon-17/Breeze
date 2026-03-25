import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export interface AnomalySignals {
  impossibleTravel?: boolean;
  countryChanged?: boolean;
  userAgentChanged?: boolean;
  rapidRefreshes?: boolean;
  unusualHour?: boolean;
  vpnOrProxyDetected?: boolean;
}

@Entity('refresh_events')
@Index(['userId', 'createdAt'])
@Index(['familyId', 'createdAt'])
@Index(['createdAt'])
export class RefreshEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  userId: string;

  @Column('uuid')
  @Index()
  familyId: string;

  @Column('uuid')
  sessionId: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  ipPrefix: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  country: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  userAgentHash: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgentRaw: string | null;

  @Column({ type: 'boolean', default: false })
  wasSuccessful: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true })
  failureReason: string | null;

  @Column({ type: 'int', default: 0 })
  riskScore: number;

  @Column({ type: 'varchar', length: 10, default: RiskLevel.LOW })
  riskLevel: RiskLevel;

  @Column({ type: 'jsonb', nullable: true })
  anomalySignals: AnomalySignals | null;

  @Column({ type: 'boolean', default: false })
  isVpnOrProxy: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
