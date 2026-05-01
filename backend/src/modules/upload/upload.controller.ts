import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
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
const MAX_ATTACHMENT_UPLOAD = 50 * 1024 * 1024; // 50 MB per file
const MAX_ATTACHMENTS_PER_MESSAGE = 10;

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

  @Post('attachments')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FilesInterceptor('files', MAX_ATTACHMENTS_PER_MESSAGE, {
      limits: { fileSize: MAX_ATTACHMENT_UPLOAD },
    }),
  )
  async uploadAttachments(
    @CurrentUser() currentUser: User,
    @UploadedFiles() files: UploadedAudioFile[] | undefined,
    @Body() _body: unknown,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Missing upload field "files"');
    }
    const attachments = await this.uploadService.uploadAttachments(
      currentUser.id,
      files,
    );
    return { attachments };
  }
}

