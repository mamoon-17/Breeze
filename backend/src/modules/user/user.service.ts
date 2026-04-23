import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Result, ok, err } from 'neverthrow';
import { User } from './user.entity';
import { AuthUser } from '../auth/types/auth.types';
import { AppError, Errors } from '../../common/errors/app-error';
import { AvatarService } from './avatar.service';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly avatarService: AvatarService,
  ) {}

  /**
   * Insert or update a user from Google OAuth
   * Returns Result<User, AppError> instead of throwing
   */
  async upsertGoogleUser(authUser: AuthUser): Promise<Result<User, AppError>> {
    try {
      // Find user by provider and providerId
      let user = await this.userRepository.findOne({
        where: {
          provider: authUser.provider,
          providerId: authUser.providerId,
        },
      });

      if (user) {
        // User exists: refresh the Google-supplied fields, but deliberately
        // leave `customDisplayName`, `customAvatarPath`, and `useGoogleAvatar`
        // alone — those represent the user's explicit override and must not
        // be reset every time they sign in.
        user.displayName = authUser.displayName;
        user.picture = authUser.picture;
        if (authUser.firstName) {
          user.firstName = authUser.firstName;
        }
        if (authUser.lastName) {
          user.lastName = authUser.lastName;
        }

        const updated = await this.userRepository.save(user);
        // Refresh the local avatar cache if Google's URL changed — the
        // avatar service is a no-op when the URL is unchanged and we still
        // have a file on disk.
        await this.avatarService.cacheGoogleAvatar(updated, authUser.picture);
        return ok(updated);
      }

      // User doesn't exist: create new
      user = this.userRepository.create({
        email: authUser.email,
        provider: authUser.provider,
        providerId: authUser.providerId,
        displayName: authUser.displayName,
        firstName: authUser.firstName,
        lastName: authUser.lastName,
        picture: authUser.picture,
        customDisplayName: null,
        useGoogleAvatar: true,
        cachedGoogleAvatarPath: null,
        cachedGoogleAvatarMime: null,
        customAvatarPath: null,
        customAvatarMime: null,
        avatarVersion: '0',
      });

      const created = await this.userRepository.save(user);
      await this.avatarService.cacheGoogleAvatar(created, authUser.picture);
      return ok(created);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(Errors.userCreationFailed(originalError.message));
    }
  }

  /**
   * Find user by provider and provider ID
   * Returns Result<User, AppError> instead of throwing or returning null
   */
  async findByProviderId(
    provider: 'google',
    providerId: string,
  ): Promise<Result<User, AppError>> {
    try {
      const user = await this.userRepository.findOne({
        where: { provider, providerId },
      });

      if (!user) {
        return err(Errors.userNotFound());
      }

      return ok(user);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(
        Errors.databaseError('Find by provider ID failed', originalError),
      );
    }
  }

  /**
   * Find user by email
   * Returns Result<User, AppError>
   */
  async findByEmail(email: string): Promise<Result<User, AppError>> {
    try {
      const user = await this.userRepository.findOne({
        where: { email },
      });

      if (!user) {
        return err(Errors.userNotFound());
      }

      return ok(user);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(Errors.databaseError('Find by email failed', originalError));
    }
  }

  /**
   * Find user by ID
   * Returns Result<User, AppError>
   */
  async findById(id: string): Promise<Result<User, AppError>> {
    try {
      const user = await this.userRepository.findOne({
        where: { id },
      });

      if (!user) {
        return err(Errors.userNotFound());
      }

      return ok(user);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(Errors.databaseError('Find by ID failed', originalError));
    }
  }

  /**
   * Update the display-name + "use Google avatar" toggle for `userId`.
   *
   * Passing `customDisplayName: ""` (or `null`) clears the override and falls
   * the effective name back to the Google-supplied `displayName`. Passing
   * `useGoogleAvatar: true` when the user has a custom avatar on disk keeps
   * the file around but stops serving it — call `AvatarService.clearCustomAvatar`
   * to also drop the bytes.
   */
  async updateProfile(
    userId: string,
    patch: { customDisplayName?: string | null; useGoogleAvatar?: boolean },
  ): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const updates: Partial<User> = {};

    if (patch.customDisplayName !== undefined) {
      const trimmed = patch.customDisplayName?.trim() ?? '';
      if (trimmed.length > 100) {
        throw new BadRequestException('Display name is too long (max 100 chars)');
      }
      updates.customDisplayName = trimmed.length === 0 ? null : trimmed;
    }

    if (patch.useGoogleAvatar !== undefined) {
      updates.useGoogleAvatar = patch.useGoogleAvatar;
    }

    if (Object.keys(updates).length > 0) {
      await this.userRepository.update(user.id, updates);
    }

    const refreshed = await this.userRepository.findOne({ where: { id: userId } });
    if (!refreshed) throw new NotFoundException('User vanished mid-update');
    return refreshed;
  }
}
