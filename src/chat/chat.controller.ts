import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../shared/guards/roles.guard';
import { Roles } from '../shared/decorators/roles.decorator';
import { CurrentUser } from '../shared/decorators/user.decorator';
import { ChatService } from './chat.service';
import { IUser } from '../shared/interfaces/user.interface';
import { Department } from 'src/shared/enums/department.enum';
import { Role } from 'src/shared/enums/role.enum';
import { ChatQueryDto, MessageQueryDto } from './dto/chat-query.dto';
import { CreateConversationDto, UpdateConversationDto } from './dto/create-conversation.dto';
import { AddParticipantDto, UpdateParticipantDto } from './dto/participant.dto';
import { CreateMessageReactionDto } from './dto/reaction.dto';
import { SendMessageDto, UpdateMessageDto } from './dto/send-message.dto';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // GESTION DES CONVERSATIONS

  @Post('conversations')
  async createConversation(
    @CurrentUser() user: IUser,
    @Body() dto: CreateConversationDto,
  ) {
    return this.chatService.createConversation(user, dto);
  }

  @Get('conversations')
  async getUserConversations(
    @CurrentUser() user: IUser,
    @Query() query: ChatQueryDto,
  ) {
    return this.chatService.getUserConversations(user, query);
  }

  @Get('conversations/:id')
  async getConversationById(
    @Param('id', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: IUser,
  ) {
    return this.chatService.getConversationById(conversationId, user);
  }

  @Put('conversations/:id')
  async updateConversation(
    @Param('id', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: IUser,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.chatService.updateConversation(conversationId, user, dto);
  }

  @Delete('conversations/:id')
  async deleteConversation(
    @Param('id', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: IUser,
  ) {
    await this.chatService.deleteConversation(conversationId, user);
    return { success: true, message: 'Conversation supprimée avec succès' };
  }

  // GESTION DES MESSAGES

  @Get('conversations/:id/messages')
  async getConversationMessages(
    @Param('id', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: IUser,
    @Query() query: MessageQueryDto,
  ) {
    return this.chatService.getConversationMessages(conversationId, user, query);
  }

  @Post('messages')
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'attachments', maxCount: 5 },
  ]))
  async sendMessage(
    @CurrentUser() user: IUser,
    @Body() dto: SendMessageDto,
    @UploadedFiles() files: { attachments?: Express.Multer.File[] },
  ) {
    // Traitement des fichiers uploadés
    if (files?.attachments) {
      dto.attachments = files.attachments.map(file => file.filename);
    }

    return this.chatService.sendMessage(user, dto);
  }

  @Put('messages/:id')
  async updateMessage(
    @Param('id', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: IUser,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.chatService.updateMessage(messageId, user, dto);
  }

  @Delete('messages/:id')
  async deleteMessage(
    @Param('id', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: IUser,
  ) {
    await this.chatService.deleteMessage(messageId, user);
    return { success: true, message: 'Message supprimé avec succès' };
  }

  // GESTION DES PARTICIPANTS

  @Post('conversations/:id/participants')
  async addParticipant(
    @Param('id', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: IUser,
    @Body() dto: AddParticipantDto,
  ) {
    return this.chatService.addParticipantToConversation(conversationId, user, dto);
  }

  @Delete('conversations/:conversationId/participants/:participantId')
  async removeParticipant(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('participantId', ParseUUIDPipe) participantId: string,
    @CurrentUser() user: IUser,
  ) {
    await this.chatService.removeParticipant(conversationId, user, participantId);
    return { success: true, message: 'Participant retiré avec succès' };
  }

  @Put('conversations/:conversationId/participants/:participantId')
  async updateParticipant(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('participantId', ParseUUIDPipe) participantId: string,
    @CurrentUser() user: IUser,
    @Body() dto: UpdateParticipantDto,
  ) {
    return this.chatService.updateParticipant(conversationId, user, participantId, dto);
  }

  // GESTION DES RÉACTIONS

  @Post('messages/reactions')
  async toggleMessageReaction(
    @CurrentUser() user: IUser,
    @Body() dto: CreateMessageReactionDto,
  ) {
    return this.chatService.toggleMessageReaction(user, dto);
  }

  // GESTION DU STATUT DE LECTURE

  @Post('conversations/:conversationId/messages/:messageId/read')
  async markMessageAsRead(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: IUser,
  ) {
    await this.chatService.markMessageAsRead(conversationId, messageId, user);
    return { success: true, message: 'Message marqué comme lu' };
  }

  @Post('conversations/:id/read')
  async markConversationAsRead(
    @Param('id', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: IUser,
  ) {
    await this.chatService.markConversationAsRead(conversationId, user);
    return { success: true, message: 'Conversation marquée comme lue' };
  }

  // ANALYTICS ET ADMINISTRATION

  @Get('analytics')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.AGENT_EY)
  async getChatAnalytics(
    @CurrentUser() user: IUser,
    @Query('department') department?: Department,
  ) {
    // Filtrer par département pour AgentEY
    const departmentFilter = user.roles.includes(Role.AGENT_EY) && !user.roles.includes(Role.ADMIN)
      ? user.department
      : department;

    return this.chatService.getChatAnalytics(user, departmentFilter);
  }

  // RECHERCHE DANS LES MESSAGES

  @Get('search')
  async searchMessages(
    @CurrentUser() user: IUser,
    @Query('q') query: string,
    @Query('conversationId') conversationId?: string,
    @Query('type') type?: string,
    @Query('page', ParseIntPipe) page: number = 1,
    @Query('limit', ParseIntPipe) limit: number = 20,
  ) {
    // Logique de recherche à implémenter
    return {
      messages: [],
      total: 0,
      page,
      limit,
    };
  }

  // EXPORT DES DONNÉES (pour la conformité)

  @Get('conversations/:id/export')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async exportConversation(
    @Param('id', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: IUser,
  ) {
    // Logique d'export à implémenter pour la conformité GDPR
    return { success: true, message: 'Export en cours de préparation' };
  }
}