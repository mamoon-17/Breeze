import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Result, ok, err } from 'neverthrow';
import { User } from './user.entity';
import { AuthUser } from '../auth/types/auth.types';
import { AppError, Errors } from '../../common/errors/app-error';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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
        // User exists: update displayName, picture, firstName, lastName if provided
        user.displayName = authUser.displayName;
        user.picture = authUser.picture;
        if (authUser.firstName) {
          user.firstName = authUser.firstName;
        }
        if (authUser.lastName) {
          user.lastName = authUser.lastName;
        }

        const updated = await this.userRepository.save(user);
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
      });

      const created = await this.userRepository.save(user);
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
}
