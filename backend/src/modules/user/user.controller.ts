import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { toHttpException } from '../../common/errors/error-handler';
import { User } from './user.entity';
import { UserService } from './user.service';
import { AvatarService } from './avatar.service';
import { EmailParamDto } from './dto/email-param.dto';
import { ProviderParamDto } from './dto/provider-param.dto';
import { IdParamDto } from './dto/id-param.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User as CurrentUser } from '../auth/decorators/current-user.decorator';
import { effectiveAvatarUrl, effectiveDisplayName } from './user-projection';

// `UploadedFile` in @nestjs/platform-express is typed against Express.Multer.File,
// but we only need a small sub-shape — declaring it here avoids pulling @types/multer
// into every caller and keeps the controller decoupled from the upload transport.
interface UploadedAvatarFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const MAX_AVATAR_UPLOAD = 5 * 1024 * 1024; // mirrors AvatarService — multer rejects at HTTP boundary.

@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly avatarService: AvatarService,
  ) {}

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

  /**
   * Serve the effective avatar for `:id` — either the cached Google image or
   * the user's custom upload, chosen by `useGoogleAvatar`. Never 302s to
   * Google; we always serve bytes we control so signed-URL expiry can't break
   * rendering. Returns 404 when the user has no avatar of any kind, letting
   * the client fall back to initials.
   *
   * This endpoint is intentionally public (no JWT) so it can be used in
   * plain `<img src>` tags without custom fetch wrapping.
   */
  @Get(':id/avatar')
  async getAvatar(@Param() params: IdParamDto, @Res() res: Response) {
    const binary = await this.avatarService.getAvatarBinary(params.id);
    if (!binary) {
      res.status(404).json({ message: 'No avatar set' });
      return;
    }

    res.setHeader('Content-Type', binary.mime);
    // Clients cache-bust via `?v=<avatarVersion>`, so we can be aggressive.
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    binary.stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    binary.stream.pipe(res);
  }

  @Patch('me/profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @CurrentUser() currentUser: User,
    @Body() dto: UpdateProfileDto,
  ) {
    const updated = await this.userService.updateProfile(currentUser.id, {
      customDisplayName: dto.customDisplayName,
      useGoogleAvatar: dto.useGoogleAvatar,
    });
    return { user: this.toPublicUser(updated) };
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('avatar', {
      limits: { fileSize: MAX_AVATAR_UPLOAD },
    }),
  )
  async uploadAvatar(
    @CurrentUser() currentUser: User,
    @UploadedFile() file: UploadedAvatarFile | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('Missing upload field "avatar"');
    }
    const updated = await this.avatarService.saveCustomAvatar(currentUser.id, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      size: file.size,
    });
    return { user: this.toPublicUser(updated) };
  }

  @Delete('me/avatar')
  @UseGuards(JwtAuthGuard)
  async deleteAvatar(@CurrentUser() currentUser: User) {
    const updated = await this.avatarService.clearCustomAvatar(currentUser.id);
    return { user: this.toPublicUser(updated) };
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
      displayName: effectiveDisplayName(user),
      // Preserve the raw Google-supplied name alongside the effective one so
      // the settings page can show "Default: <google name>" as a hint.
      googleDisplayName: user.displayName,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: effectiveAvatarUrl(user),
      useGoogleAvatar: user.useGoogleAvatar,
      hasCustomAvatar: Boolean(user.customAvatarPath),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

// Surface `NotFoundException` from the service layer as a 404 HTTP response.
// (Referenced by @ts-noUnusedLocals — keep import.)
void NotFoundException;
