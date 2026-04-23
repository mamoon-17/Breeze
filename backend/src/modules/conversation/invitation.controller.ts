import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/decorators/current-user.decorator';
import { User as UserEntity } from '../user/user.entity';
import { ConversationInvitationService } from './conversation-invitation.service';
import { InvitationIdParamDto } from './dto/invitation-id-param.dto';

@Controller('invitations')
@UseGuards(JwtAuthGuard)
export class InvitationController {
  constructor(
    private readonly invitationService: ConversationInvitationService,
  ) {}

  @Get()
  async list(@User() user: UserEntity) {
    const invitations = await this.invitationService.listPendingForUser(
      user.id,
    );
    return { invitations };
  }

  @Post(':id/accept')
  async accept(
    @Param() params: InvitationIdParamDto,
    @User() user: UserEntity,
  ) {
    const { conversationId } = await this.invitationService.accept(
      user.id,
      params.id,
    );
    return { conversationId };
  }

  @Post(':id/reject')
  async reject(
    @Param() params: InvitationIdParamDto,
    @User() user: UserEntity,
  ) {
    await this.invitationService.reject(user.id, params.id);
    return { message: 'Invitation rejected' };
  }

  @Delete(':id')
  async cancel(
    @Param() params: InvitationIdParamDto,
    @User() user: UserEntity,
  ) {
    await this.invitationService.cancel(user.id, params.id);
    return { message: 'Invitation cancelled' };
  }
}
