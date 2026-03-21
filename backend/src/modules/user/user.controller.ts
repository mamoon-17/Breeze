import { Controller, Get, Param } from '@nestjs/common';
import { toHttpException } from '../../common/errors/error-handler';
import { Errors } from '../../common/errors/app-error';
import { User } from './user.entity';
import { UserService } from './user.service';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('email/:email')
  async getByEmail(@Param('email') email: string) {
    const result = await this.userService.findByEmail(email);
    if (result.isErr()) {
      throw toHttpException(result.error);
    }

    return {
      user: this.toPublicUser(result.value),
    };
  }

  @Get('provider/:provider/:providerId')
  async getByProvider(
    @Param('provider') providerParam: string,
    @Param('providerId') providerId: string,
  ) {
    if (providerParam !== 'google' && providerParam !== 'local') {
      throw toHttpException(
        Errors.validationFailed("provider must be either 'google' or 'local'"),
      );
    }

    const result = await this.userService.findByProviderId(
      providerParam,
      providerId,
    );
    if (result.isErr()) {
      throw toHttpException(result.error);
    }

    return {
      user: this.toPublicUser(result.value),
    };
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const result = await this.userService.findById(id);
    if (result.isErr()) {
      throw toHttpException(result.error);
    }

    return {
      user: this.toPublicUser(result.value),
    };
  }

  private toPublicUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      provider: user.provider,
      providerId: user.providerId,
      displayName: user.displayName,
      firstName: user.firstName,
      lastName: user.lastName,
      picture: user.picture,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
