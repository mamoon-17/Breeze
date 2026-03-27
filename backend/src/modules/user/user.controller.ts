import { Controller, Get, Param } from '@nestjs/common';
import { toHttpException } from '../../common/errors/error-handler';
import { User } from './user.entity';
import { UserService } from './user.service';
import { EmailParamDto } from './dto/email-param.dto';
import { ProviderParamDto } from './dto/provider-param.dto';
import { IdParamDto } from './dto/id-param.dto';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('email/:email')
  async getByEmail(@Param() params: EmailParamDto) {
    const result = await this.userService.findByEmail(params.email);
    if (result.isErr()) {
      throw toHttpException(result.error);
    }

    return {
      user: this.toPublicUser(result.value),
    };
  }

  @Get('provider/:provider/:providerId')
  async getByProvider(@Param() params: ProviderParamDto) {
    const result = await this.userService.findByProviderId(
      params.provider,
      params.providerId,
    );
    if (result.isErr()) {
      throw toHttpException(result.error);
    }

    return {
      user: this.toPublicUser(result.value),
    };
  }

  @Get(':id')
  async getById(@Param() params: IdParamDto) {
    const result = await this.userService.findById(params.id);
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
