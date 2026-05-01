import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User as CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../user/user.entity';
import { UploadService } from './upload.service';

interface UploadedAudioFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const MAX_AUDIO_UPLOAD = 25 * 1024 * 1024; // 25 MB

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('audio')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: { fileSize: MAX_AUDIO_UPLOAD },
    }),
  )
  async uploadAudio(
    @CurrentUser() currentUser: User,
    @UploadedFile() file: UploadedAudioFile | undefined,
    @Body() _body: unknown,
  ) {
    if (!file) {
      throw new BadRequestException('Missing upload field "audio"');
    }
    const uploaded = await this.uploadService.uploadAudio(currentUser.id, file);
    return {
      attachmentUrl: uploaded.url,
      attachmentType: 'audio',
      contentType: uploaded.contentType,
      size: uploaded.size,
    };
  }
}

