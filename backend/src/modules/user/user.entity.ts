import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 100 })
  provider: 'google';

  @Column({ type: 'varchar', length: 255 })
  providerId: string;

  @Column({ type: 'varchar', length: 255 })
  displayName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  firstName?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  lastName?: string;

  @Column({ type: 'text', nullable: true })
  picture?: string;

  /**
   * User-chosen display name that overrides the Google-supplied one.
   * `null` means "fall back to `displayName`". The effective name is
   * `customDisplayName ?? displayName`.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  customDisplayName: string | null;

  /**
   * When true, the avatar served by our `/user/:id/avatar` endpoint is the
   * cached copy of the Google profile picture. When false, it is the
   * user-uploaded file at `customAvatarPath`. Defaults to `true` so existing
   * accounts keep their existing visual.
   */
  @Column({ type: 'boolean', default: true })
  useGoogleAvatar: boolean;

  /**
   * Absolute filesystem path to the locally-cached Google avatar. We download
   * Google's picture on sign-in (and on refresh when the URL changes) so
   * Google's signed-URL expiry can't break rendering for our users.
   */
  @Column({ type: 'text', nullable: true })
  cachedGoogleAvatarPath: string | null;

  /** Mime type of the cached Google avatar (e.g. `image/jpeg`). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  cachedGoogleAvatarMime: string | null;

  /** Absolute filesystem path to a user-uploaded custom avatar. */
  @Column({ type: 'text', nullable: true })
  customAvatarPath: string | null;

  /** Mime type of the user-uploaded custom avatar. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  customAvatarMime: string | null;

  /** Bumped whenever the stored avatar bytes change; used as a cache-buster. */
  @Column({ type: 'bigint', default: 0 })
  avatarVersion: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
