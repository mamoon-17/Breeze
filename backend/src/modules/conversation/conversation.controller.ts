import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/decorators/current-user.decorator';
import { User as UserEntity } from '../user/user.entity';
import { ConversationService } from './conversation.service';
import { ConversationInvitationService } from './conversation-invitation.service';
import { ChatService } from '../chat/chat.service';
import { CreateDmDto } from './dto/create-dm.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { InviteEmailsDto } from './dto/invite-emails.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { ConversationIdParamDto } from './dto/conversation-id-param.dto';
import { MemberIdParamDto } from './dto/member-id-param.dto';
import { HistoryQueryDto } from './dto/history-query.dto';

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly invitationService: ConversationInvitationService,
    private readonly chatService: ChatService,
  ) {}

  // ─── DM ────────────────────────────────────────────────────────────────────

  @Post('dm')
  async getOrCreateDm(@Body() dto: CreateDmDto, @User() user: UserEntity) {
    const conversation = await this.conversationService.getOrCreateDmByEmail(
      user.id,
      dto.targetEmail,
    );
    return { conversationId: conversation.id };
  }

  // ─── Group ─────────────────────────────────────────────────────────────────

  @Post('group')
  async createGroup(@Body() dto: CreateGroupDto, @User() user: UserEntity) {
    const result = await this.conversationService.createGroup(user.id, dto);
    return {
      conversationId: result.conversation.id,
      name: result.conversation.name,
      invitations: result.invitations,
      unknownEmails: result.unknownEmails,
      skipped: result.skipped,
    };
  }

  // ─── Shared ────────────────────────────────────────────────────────────────

  @Get()
  async getMyConversations(@User() user: UserEntity) {
    const conversations =
      await this.conversationService.getConversationsForUser(user.id);
    return { conversations };
  }

  @Get('unread-counts')
  async getUnreadCounts(@User() user: UserEntity) {
    const counts = await this.chatService.getUnreadCounts(user.id);
    return { counts };
  }

  @Patch(':id')
  async updateConversation(
    @Param() params: ConversationIdParamDto,
    @Body() dto: UpdateConversationDto,
    @User() user: UserEntity,
  ) {
    const conversation = await this.conversationService.updateConversation(
      user.id,
      params.id,
      dto,
    );
    return { conversation };
  }

  @Get(':id/members')
  async getMembers(
    @Param() params: ConversationIdParamDto,
    @User() user: UserEntity,
  ) {
    const members = await this.conversationService.getMembers(
      user.id,
      params.id,
    );
    return { members };
  }

  /**
   * Invite one or more users (by email) to a group. Unknown emails are
   * returned in `unknownEmails` so the client can prompt "not on Breeze".
   */
  @Post(':id/invites')
  async inviteToGroup(
    @Param() params: ConversationIdParamDto,
    @Body() dto: InviteEmailsDto,
    @User() user: UserEntity,
  ) {
    const result = await this.invitationService.inviteEmails(
      user.id,
      params.id,
      dto.emails,
    );
    return result;
  }

  @Delete(':id/members/:userId')
  async removeMember(
    @Param() params: MemberIdParamDto,
    @User() user: UserEntity,
  ) {
    await this.conversationService.removeMember(
      user.id,
      params.id,
      params.userId,
    );
    return { message: 'Member removed successfully' };
  }

  @Post(':id/leave')
  async leaveGroup(@Param() params: ConversationIdParamDto, @User() user: UserEntity) {
    await this.conversationService.leaveGroup(user.id, params.id);
    return { message: 'Left group successfully' };
  }

  // ─── History ───────────────────────────────────────────────────────────────

  @Get(':id/history')
  async getHistory(
    @Param() params: ConversationIdParamDto,
    @Query() query: HistoryQueryDto,
    @User() user: UserEntity,
  ) {
    await this.conversationService.requireMember(user.id, params.id);
    const messages = await this.chatService.getRoomHistory(
      params.id,
      query.limit,
      query.before,
    );
    return { messages };
  }
}
