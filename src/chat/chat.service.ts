
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not, IsNull } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { Participant } from './entities/participant.entity';
import { MessageStatus } from './entities/message-status.entity';
import { ConversationInvite } from './entities/conversation-invite.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { KafkaProducerService } from '../notifications/kafka/producer.service';
import { IntegrationService } from '../integration/integration.service';
import { ChatGateway } from './chat.gateway';
import { KAFKA_TOPICS } from '../config/kafka.config';

import { IUser } from '../shared/interfaces/user.interface';
import { ConversationType } from 'src/shared/enums/conversation-type.enum';
import { Department } from 'src/shared/enums/department.enum';
import { NotificationType } from 'src/shared/enums/notification-type.enum';
import { Role } from 'src/shared/enums/role.enum';
import { ChatAnalyticsDto } from './dto/chat-analytics.dto';
import { ChatQueryDto, MessageQueryDto } from './dto/chat-query.dto';
import { ConversationDto } from './dto/conversation.dto';
import { CreateConversationDto, UpdateConversationDto } from './dto/create-conversation.dto';
import { MessageDto } from './dto/message.dto';
import { AddParticipantDto, ParticipantDto, UpdateParticipantDto } from './dto/participant.dto';
import { CreateMessageReactionDto, MessageReactionDto } from './dto/reaction.dto';
import { SendMessageDto, UpdateMessageDto } from './dto/send-message.dto';
import { Injectable, ForbiddenException, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { MessageReaction } from './entities/message-reaction.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Conversation)
    private conversationRepository: Repository<Conversation>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(Participant)
    private participantRepository: Repository<Participant>,
    @InjectRepository(MessageStatus)
    private messageStatusRepository: Repository<MessageStatus>,
    @InjectRepository(MessageReaction)
    private reactionRepository: Repository<MessageReaction>,
    @InjectRepository(ConversationInvite)
    private inviteRepository: Repository<ConversationInvite>,
    private notificationsService: NotificationsService,
    private kafkaProducer: KafkaProducerService,
    private integrationService: IntegrationService,
    private chatGateway: ChatGateway,
  ) {}

  // GESTION DES CONVERSATIONS

  async createConversation(user: IUser, dto: CreateConversationDto): Promise<ConversationDto> {
    // Validation des permissions
    if (!user.isActive) {
      throw new ForbiddenException('Votre compte doit être activé pour créer des conversations');
    }

    // Validation spécifique selon le type de conversation
    if (dto.type === ConversationType.DEPARTMENT && !dto.department) {
      dto.department = user.department;
    }

    if (dto.type === ConversationType.DIRECT && (!dto.participantIds || dto.participantIds.length !== 1)) {
      throw new BadRequestException('Une conversation directe doit avoir exactement un autre participant');
    }

    // Vérifier si une conversation directe existe déjà
    if (dto.type === ConversationType.DIRECT) {
      const existingDirect = await this.findExistingDirectConversation(user.id, dto.participantIds[0]);
      if (existingDirect) {
        return this.mapConversationToDto(existingDirect, user);
      }
    }

    // Créer la conversation
    const conversation = this.conversationRepository.create({
      type: dto.type,
      name: dto.name || this.generateConversationName(dto.type, user),
      description: dto.description,
      creatorId: user.id,
      creatorName: user.fullName,
      creatorProfilePicture: user.profilePicture,
      department: dto.department,
      isPrivate: dto.isPrivate ?? false,
      tags: dto.tags,
      settings: dto.settings,
      participantsCount: 1, // Le créateur
    });

    const savedConversation = await this.conversationRepository.save(conversation);

    // Ajouter le créateur comme participant owner
    await this.addParticipant(savedConversation.id, {
      userId: user.id,
      userName: user.fullName,
      userProfilePicture: user.profilePicture,
      userDepartment: user.department,
      role: 'owner',
      isActive: true,
      canSendMessages: true,
      canAddParticipants: true,
      canDeleteMessages: true,
    });

    // Ajouter les autres participants
    if (dto.participantIds && dto.participantIds.length > 0) {
      for (const participantId of dto.participantIds) {
        if (participantId !== user.id) {
            await this.addParticipant(savedConversation.id, {
              userId: participantId,
              role: 'member',
              isActive: true,
              canSendMessages: true,
              canAddParticipants: dto.type !== ConversationType.DIRECT,
              canDeleteMessages: false,
              invitedById: user.id,
              invitedByName: user.fullName,
            });
        }
      }

      // Mettre à jour le compteur de participants
      savedConversation.participantsCount = dto.participantIds.length + 1;
      await this.conversationRepository.save(savedConversation);
    }

    // Publier l'événement dans Kafka
    await this.kafkaProducer.publish(KAFKA_TOPICS.CONVERSATION_CREATED, {
      id: savedConversation.id,
      type: savedConversation.type,
      name: savedConversation.name,
      creatorId: user.id,
      creatorName: user.fullName,
      participantIds: dto.participantIds || [],
      timestamp: new Date(),
    });

    // Notifier via WebSocket
    await this.chatGateway.notifyConversationCreated(savedConversation.id, savedConversation);

    // Notifier l'activité au service .NET Core
  /*  await this.integrationService.notifyDotNetOfChatActivity({
      userId: user.id,
      conversationId: savedConversation.id,
      activityType: 'CONVERSATION_CREATED',
      details: {
        conversationType: savedConversation.type,
        participantsCount: savedConversation.participantsCount,
      },
    });
*/
    return this.mapConversationToDto(savedConversation, user);
  }

  async updateConversation(conversationId: string, user: IUser, dto: UpdateConversationDto): Promise<ConversationDto> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, isActive: true },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    // Vérifier les permissions
    const participant = await this.getParticipant(conversationId, user.id);
    if (!participant || !this.canManageConversation(participant, user)) {
      throw new ForbiddenException('Vous n\'avez pas les permissions pour modifier cette conversation');
    }

    // Mise à jour des champs
    if (dto.name !== undefined) conversation.name = dto.name;
    if (dto.description !== undefined) conversation.description = dto.description;
    if (dto.isPrivate !== undefined) conversation.isPrivate = dto.isPrivate;
    if (dto.tags !== undefined) conversation.tags = dto.tags;
    if (dto.settings !== undefined) {
      conversation.settings = { ...conversation.settings, ...dto.settings };
    }

    const updatedConversation = await this.conversationRepository.save(conversation);

    // Notifier via WebSocket
    await this.chatGateway.notifyConversationUpdated(conversationId, updatedConversation);

    return this.mapConversationToDto(updatedConversation, user);
  }

  async deleteConversation(conversationId: string, user: IUser): Promise<void> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, isActive: true },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    const participant = await this.getParticipant(conversationId, user.id);
    if (!participant || (!this.canManageConversation(participant, user) && participant.role !== 'owner')) {
      throw new ForbiddenException('Vous n\'avez pas les permissions pour supprimer cette conversation');
    }

    // Soft delete
    conversation.isActive = false;
    conversation.archivedAt = new Date();
    await this.conversationRepository.save(conversation);

    // Notifier via WebSocket
    await this.chatGateway.notifyConversationDeleted(conversationId);
  }

  async getUserConversations(user: IUser, query: ChatQueryDto) {
    const queryBuilder = this.conversationRepository
      .createQueryBuilder('conv')
      .leftJoin('conv.participants', 'participant')
      .where('participant.userId = :userId', { userId: user.id })
      .andWhere('participant.isActive = true')
      .andWhere('conv.isActive = true');

    // Filtres
    if (query.type) {
      queryBuilder.andWhere('conv.type = :type', { type: query.type });
    }

    if (query.department) {
      queryBuilder.andWhere('conv.department = :department', { department: query.department });
    }

    if (query.search) {
      queryBuilder.andWhere('conv.name ILIKE :search', { search: `%${query.search}%` });
    }

    if (query.unreadOnly) {
      queryBuilder.andWhere('participant.unreadCount > 0');
    }

    // Tri par dernière activité
    queryBuilder.orderBy('conv.lastMessageAt', 'DESC');

    // Pagination
    const offset = (query.page - 1) * query.limit;
    const [conversations, total] = await queryBuilder
      .skip(offset)
      .take(query.limit)
      .getManyAndCount();

    const enrichedConversations = await Promise.all(
      conversations.map(conv => this.mapConversationToDto(conv, user))
    );

    return {
      conversations: enrichedConversations,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getConversationById(conversationId: string, user: IUser): Promise<ConversationDto> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, isActive: true },
      relations: ['participants'],
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    // Vérifier que l'utilisateur est participant
    const participant = conversation.participants.find(p => p.userId === user.id && p.isActive);
    if (!participant) {
      throw new ForbiddenException('Vous n\'avez pas accès à cette conversation');
    }

    return this.mapConversationToDto(conversation, user);
  }

  // GESTION DES MESSAGES

  async sendMessage(user: IUser, dto: SendMessageDto): Promise<MessageDto> {
    // Vérifier que l'utilisateur peut envoyer des messages dans cette conversation
    const participant = await this.getParticipant(dto.conversationId, user.id);
    if (!participant || !participant.isActive) {
      throw new ForbiddenException('Vous n\'êtes pas membre de cette conversation');
    }

    if (!participant.canSendMessages) {
      throw new ForbiddenException('Vous n\'avez pas la permission d\'envoyer des messages');
    }

    // Validation du message de réponse
    let replyToMessage = null;
    if (dto.replyToId) {
      replyToMessage = await this.messageRepository.findOne({
        where: { id: dto.replyToId, conversationId: dto.conversationId, isDeleted: false },
      });

      if (!replyToMessage) {
        throw new NotFoundException('Message de réponse non trouvé');
      }
    }

    // Traitement des mentions
    const mentions = this.extractMentions(dto.content, dto.mentions || []);

    // Créer le message
    const message = this.messageRepository.create({
      conversationId: dto.conversationId,
      senderId: user.id,
      senderName: user.fullName,
      senderProfilePicture: user.profilePicture,
      senderDepartment: user.department,
      type: dto.type,
      content: dto.content,
      attachments: dto.attachments,
      mentions,
      replyToId: dto.replyToId,
      replyToContent: replyToMessage?.content?.substring(0, 100),
      replyToSenderName: replyToMessage?.senderName,
      metadata: dto.metadata,
    });

    const savedMessage = await this.messageRepository.save(message);

    // Mettre à jour la conversation
    await this.conversationRepository.update(dto.conversationId, {
      lastMessageAt: new Date(),
      lastMessage: dto.content.substring(0, 100),
      lastMessageById: user.id,
      lastMessageByName: user.fullName,
      messagesCount: () => 'messagesCount + 1',
    });

    // Mettre à jour les compteurs non lus pour les autres participants
    await this.updateUnreadCounts(dto.conversationId, user.id);

    // Créer les statuts de message pour tous les participants
    await this.createMessageStatuses(savedMessage);

    // Publier l'événement dans Kafka
    await this.kafkaProducer.publish(KAFKA_TOPICS.MESSAGE_SENT, {
      id: savedMessage.id,
      conversationId: dto.conversationId,
      senderId: user.id,
      senderName: user.fullName,
      type: dto.type,
      content: dto.content.substring(0, 200),
      mentions,
      timestamp: new Date(),
    });

    // Notifier via WebSocket en temps réel
    await this.chatGateway.notifyMessageSent(dto.conversationId, savedMessage);

    // Envoyer des notifications aux participants
    await this.notifyMessageRecipients(savedMessage, user);

    // Notifier l'activité au service .NET Core
   /* await this.integrationService.notifyDotNetOfChatActivity({
      userId: user.id,
      conversationId: dto.conversationId,
      activityType: 'MESSAGE_SENT',
      details: {
        messageId: savedMessage.id,
        messageType: dto.type,
        hasAttachments: !!(dto.attachments?.length),
        mentionsCount: mentions.length,
      },
    });
*/
    return this.mapMessageToDto(savedMessage, user);
  }

  async updateMessage(messageId: string, user: IUser, dto: UpdateMessageDto): Promise<MessageDto> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId, isDeleted: false },
    });

    if (!message) {
      throw new NotFoundException('Message non trouvé');
    }

    // Vérifier les permissions
    if (message.senderId !== user.id && !this.canModerateContent(user)) {
      throw new ForbiddenException('Vous ne pouvez modifier que vos propres messages');
    }

    // Vérifier que le message peut être modifié (par exemple, dans les 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (message.createdAt < fiveMinutesAgo && message.senderId === user.id && !this.canModerateContent(user)) {
      throw new ForbiddenException('Vous ne pouvez plus modifier ce message');
    }

    // Mise à jour
    if (dto.content !== undefined) {
      message.content = dto.content;
      message.mentions = this.extractMentions(dto.content, dto.mentions || []);
      message.isEdited = true;
    }

    const updatedMessage = await this.messageRepository.save(message);

    // Notifier via WebSocket
    await this.chatGateway.notifyMessageUpdated(message.conversationId, updatedMessage);

    return this.mapMessageToDto(updatedMessage, user);
  }

  async deleteMessage(messageId: string, user: IUser): Promise<void> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId, isDeleted: false },
    });

    if (!message) {
      throw new NotFoundException('Message non trouvé');
    }

    // Vérifier les permissions
    const participant = await this.getParticipant(message.conversationId, user.id);
    if (message.senderId !== user.id && !participant?.canDeleteMessages && !this.canModerateContent(user)) {
      throw new ForbiddenException('Vous n\'avez pas la permission de supprimer ce message');
    }

    // Soft delete
    message.isDeleted = true;
    message.deletedAt = new Date();
    message.deletedById = user.id;
    await this.messageRepository.save(message);

    // Notifier via WebSocket
    await this.chatGateway.notifyMessageDeleted(message.conversationId, messageId);
  }

  async getConversationMessages(conversationId: string, user: IUser, query: MessageQueryDto) {
    // Vérifier l'accès à la conversation
    const participant = await this.getParticipant(conversationId, user.id);
    if (!participant || !participant.isActive) {
      throw new ForbiddenException('Vous n\'avez pas accès à cette conversation');
    }

    const queryBuilder = this.messageRepository
      .createQueryBuilder('message')
      .where('message.conversationId = :conversationId', { conversationId })
      .andWhere('message.isDeleted = false');

    // Filtres
    if (query.search) {
      queryBuilder.andWhere('message.content ILIKE :search', { search: `%${query.search}%` });
    }

    if (query.type) {
      queryBuilder.andWhere('message.type = :type', { type: query.type });
    }

    if (query.pinnedOnly) {
      queryBuilder.andWhere('message.isPinned = true');
    }

    // Pagination curseur
    if (query.before) {
      const beforeMessage = await this.messageRepository.findOne({ where: { id: query.before } });
      if (beforeMessage) {
        queryBuilder.andWhere('message.createdAt < :beforeDate', { beforeDate: beforeMessage.createdAt });
      }
    }

    if (query.after) {
      const afterMessage = await this.messageRepository.findOne({ where: { id: query.after } });
      if (afterMessage) {
        queryBuilder.andWhere('message.createdAt > :afterDate', { afterDate: afterMessage.createdAt });
      }
    }

    // Tri et pagination
    queryBuilder.orderBy('message.createdAt', 'DESC');
    queryBuilder.take(query.limit);

    const messages = await queryBuilder.getMany();

    // Enrichir avec les données utilisateur
    const enrichedMessages = await Promise.all(
      messages.map(message => this.mapMessageToDto(message, user))
    );

    return {
      messages: enrichedMessages.reverse(), // Ordre chronologique
      hasMore: messages.length === query.limit,
    };
  }

  // GESTION DES PARTICIPANTS

  async addParticipantToConversation(conversationId: string, user: IUser, dto: AddParticipantDto): Promise<ParticipantDto> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, isActive: true },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    // Vérifier les permissions
    const requesterParticipant = await this.getParticipant(conversationId, user.id);
    if (!requesterParticipant || !requesterParticipant.canAddParticipants) {
      throw new ForbiddenException('Vous n\'avez pas la permission d\'ajouter des participants');
    }


    // Vérifier qu'il n'est pas déjà participant
    const existingParticipant = await this.getParticipant(conversationId, dto.userId);
    if (existingParticipant && existingParticipant.isActive) {
      throw new ConflictException('Cet utilisateur est déjà participant');
    }

    // Ajouter le participant
    const participant = await this.addParticipant(conversationId, {
      userId: dto.userId,
      role: dto.role || 'member',
      nickname: dto.nickname,
      invitedById: user.id,
      invitedByName: user.fullName,
    });

    // Mettre à jour le compteur de participants
    await this.conversationRepository.increment({ id: conversationId }, 'participantsCount', 1);


    // Notifier via WebSocket
    await this.chatGateway.notifyParticipantAdded(conversationId, participant);

    return this.mapParticipantToDto(participant);
  }

  async removeParticipant(conversationId: string, user: IUser, participantId: string): Promise<void> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, isActive: true },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    const requesterParticipant = await this.getParticipant(conversationId, user.id);
    const targetParticipant = await this.getParticipant(conversationId, participantId);

    if (!targetParticipant || !targetParticipant.isActive) {
      throw new NotFoundException('Participant non trouvé');
    }

    // Vérifier les permissions
    const canRemove = 
      requesterParticipant?.role === 'owner' ||
      (requesterParticipant?.role === 'admin' && targetParticipant.role === 'member') ||
      (participantId === user.id); // L'utilisateur peut se retirer lui-même

    if (!canRemove) {
      throw new ForbiddenException('Vous n\'avez pas la permission de retirer ce participant');
    }

    // Retirer le participant
    targetParticipant.isActive = false;
    targetParticipant.leftAt = new Date();
    await this.participantRepository.save(targetParticipant);

    // Mettre à jour le compteur
    await this.conversationRepository.decrement({ id: conversationId }, 'participantsCount', 1);

    // Notifier via WebSocket
    await this.chatGateway.notifyParticipantRemoved(conversationId, participantId);
  }

  async updateParticipant(conversationId: string, user: IUser, participantId: string, dto: UpdateParticipantDto): Promise<ParticipantDto> {
    const requesterParticipant = await this.getParticipant(conversationId, user.id);
    const targetParticipant = await this.getParticipant(conversationId, participantId);

    if (!targetParticipant || !targetParticipant.isActive) {
      throw new NotFoundException('Participant non trouvé');
    }

    // Vérifier les permissions
    const canUpdate = 
      requesterParticipant?.role === 'owner' ||
      (requesterParticipant?.role === 'admin' && targetParticipant.role === 'member') ||
      (participantId === user.id && this.isPersonalUpdate(dto));

    if (!canUpdate) {
      throw new ForbiddenException('Vous n\'avez pas la permission de modifier ce participant');
    }

    // Mise à jour
    if (dto.role !== undefined && requesterParticipant?.role === 'owner') {
      targetParticipant.role = dto.role;
    }
    if (dto.canSendMessages !== undefined) targetParticipant.canSendMessages = dto.canSendMessages;
    if (dto.canAddParticipants !== undefined) targetParticipant.canAddParticipants = dto.canAddParticipants;
    if (dto.canDeleteMessages !== undefined) targetParticipant.canDeleteMessages = dto.canDeleteMessages;
    if (dto.nickname !== undefined) targetParticipant.nickname = dto.nickname;
    if (dto.isMuted !== undefined) targetParticipant.isMuted = dto.isMuted;
    if (dto.mutedUntil !== undefined) targetParticipant.mutedUntil = dto.mutedUntil;

    const updatedParticipant = await this.participantRepository.save(targetParticipant);

    // Notifier via WebSocket
    await this.chatGateway.notifyParticipantUpdated(conversationId, updatedParticipant);

    return this.mapParticipantToDto(updatedParticipant);
  }

  // GESTION DES RÉACTIONS

  async toggleMessageReaction(user: IUser, dto: CreateMessageReactionDto): Promise<{ action: 'added' | 'removed' | 'updated'; reaction?: MessageReactionDto }> {
    // Vérifier que le message existe et que l'utilisateur y a accès
    const message = await this.messageRepository.findOne({
      where: { id: dto.messageId, isDeleted: false },
    });

    if (!message) {
      throw new NotFoundException('Message non trouvé');
    }

    const participant = await this.getParticipant(message.conversationId, user.id);
    if (!participant || !participant.isActive) {
      throw new ForbiddenException('Vous n\'avez pas accès à cette conversation');
    }

    // Chercher une réaction existante
    const existingReaction = await this.reactionRepository.findOne({
      where: {
        messageId: dto.messageId,
        userId: user.id,
      },
    });

    if (existingReaction) {
      if (existingReaction.type === dto.type) {
        // Retirer la réaction
        await this.reactionRepository.remove(existingReaction);
        await this.messageRepository.decrement({ id: dto.messageId }, 'reactionsCount', 1);
        
        // Notifier via WebSocket
        await this.chatGateway.notifyReactionRemoved(message.conversationId, dto.messageId, user.id);
        
        return { action: 'removed' };
      } else {
        // Changer le type de réaction
        existingReaction.type = dto.type;
        const updatedReaction = await this.reactionRepository.save(existingReaction);
        
        // Notifier via WebSocket
        await this.chatGateway.notifyReactionUpdated(message.conversationId, updatedReaction);
        
        return { action: 'updated', reaction: this.mapReactionToDto(updatedReaction) };
      }
    } else {
      // Ajouter une nouvelle réaction
      const reaction = this.reactionRepository.create({
        type: dto.type,
        userId: user.id,
        userName: user.fullName,
        userProfilePicture: user.profilePicture,
        userDepartment: user.department,
        messageId: dto.messageId,
      });

      const savedReaction = await this.reactionRepository.save(reaction);
      await this.messageRepository.increment({ id: dto.messageId }, 'reactionsCount', 1);

      // Notifier l'auteur du message si ce n'est pas la même personne
      if (message.senderId !== user.id) {
        await this.notificationsService.createNotification({
          type: NotificationType.MESSAGE_RECEIVED,
          title: 'Réaction à votre message',
          content: `${user.fullName} a réagi à votre message avec ${dto.type}`,
          userId: message.senderId,
          senderId: user.id,
          senderName: user.fullName,
          targetId: message.conversationId,
          targetType: 'conversation',
          actionUrl: `/chat/conversations/${message.conversationId}#message-${message.id}`,
          data: {
            messageId: message.id,
            reactionType: dto.type,
          },
        });
      }

      // Notifier via WebSocket
      await this.chatGateway.notifyReactionAdded(message.conversationId, savedReaction);

      return { action: 'added', reaction: this.mapReactionToDto(savedReaction) };
    }
  }

  // GESTION DU STATUT DES MESSAGES

  async markMessageAsRead(conversationId: string, messageId: string, user: IUser): Promise<void> {
    // Vérifier l'accès
    const participant = await this.getParticipant(conversationId, user.id);
    if (!participant || !participant.isActive) {
      throw new ForbiddenException('Vous n\'avez pas accès à cette conversation');
    }

    // Mettre à jour le statut du message
    const messageStatus = await this.messageStatusRepository.findOne({
      where: { messageId, userId: user.id },
    });

    if (messageStatus && messageStatus.status !== 'read') {
      messageStatus.status = 'read';
      messageStatus.readAt = new Date();
      await this.messageStatusRepository.save(messageStatus);
    }

    // Mettre à jour le dernier message lu du participant
    participant.lastMessageReadId = messageId;
    participant.lastSeenAt = new Date();
    await this.participantRepository.save(participant);

    // Recalculer le compteur de messages non lus
    await this.recalculateUnreadCount(conversationId, user.id);

    // Notifier via WebSocket
    await this.chatGateway.notifyMessageRead(conversationId, messageId, user.id);
  }

  async markConversationAsRead(conversationId: string, user: IUser): Promise<void> {
    const participant = await this.getParticipant(conversationId, user.id);
    if (!participant || !participant.isActive) {
      throw new ForbiddenException('Vous n\'avez pas accès à cette conversation');
    }

    // Trouver le dernier message de la conversation
    const lastMessage = await this.messageRepository.findOne({
      where: { conversationId, isDeleted: false },
      order: { createdAt: 'DESC' },
    });

    if (lastMessage) {
      // Marquer tous les messages comme lus
      await this.messageStatusRepository.update(
        { 
          messageId: In(
            await this.messageRepository.find({
              where: { conversationId, isDeleted: false },
              select: ['id'],
            }).then(messages => messages.map(m => m.id))
          ),
          userId: user.id,
          status: Not('read'),
        },
        { status: 'read', readAt: new Date() }
      );

      // Mettre à jour le participant
      participant.lastMessageReadId = lastMessage.id;
      participant.lastSeenAt = new Date();
      participant.unreadCount = 0;
      await this.participantRepository.save(participant);

      // Notifier via WebSocket
      await this.chatGateway.notifyConversationRead(conversationId, user.id);
    }
  }

  // ANALYTICS ET STATISTIQUES

  async getChatAnalytics(user: IUser, department?: Department): Promise<ChatAnalyticsDto> {
    // Filtrer par département pour AgentEY
    const departmentFilter = user.roles.includes(Role.AGENT_EY) && !user.roles.includes(Role.ADMIN)
      ? user.department
      : department;

    // Requêtes de base
    const conversationsQuery = this.conversationRepository
      .createQueryBuilder('conv')
      .where('conv.isActive = true');

    const messagesQuery = this.messageRepository
      .createQueryBuilder('msg')
      .leftJoin('msg.conversation', 'conv')
      .where('msg.isDeleted = false')
      .andWhere('conv.isActive = true');

    if (departmentFilter) {
      conversationsQuery.andWhere('conv.department = :department', { department: departmentFilter });
      messagesQuery.andWhere('conv.department = :department', { department: departmentFilter });
    }

    // Calculer les statistiques
    const [
      totalConversations,
      activeConversations,
      totalMessages,
      dailyMessages,
      weeklyMessages,
      monthlyMessages,
    ] = await Promise.all([
      conversationsQuery.getCount(),
      conversationsQuery
        .andWhere('conv.lastMessageAt > :weekAgo', { weekAgo: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) })
        .getCount(),
      messagesQuery.getCount(),
      messagesQuery.clone()
        .andWhere('msg.createdAt > :dayAgo', { dayAgo: new Date(Date.now() - 24 * 60 * 60 * 1000) })
        .getCount(),
      messagesQuery.clone()
        .andWhere('msg.createdAt > :weekAgo', { weekAgo: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) })
        .getCount(),
      messagesQuery.clone()
        .andWhere('msg.createdAt > :monthAgo', { monthAgo: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
        .getCount(),
    ]);

    // Statistiques par type de conversation
    const conversationsByType = await conversationsQuery
      .select('conv.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .groupBy('conv.type')
      .getRawMany();

    // Statistiques par département
    const conversationsByDepartment = await conversationsQuery
      .select('conv.department', 'department')
      .addSelect('COUNT(*)', 'count')
      .groupBy('conv.department')
      .getRawMany();

    // Top conversations actives
    const topActiveConversations = await conversationsQuery
      .select(['conv.id', 'conv.name', 'conv.messagesCount', 'conv.participantsCount', 'conv.lastMessageAt'])
      .orderBy('conv.messagesCount', 'DESC')
      .take(10)
      .getMany();

    // Statistiques par type de message
    const messageTypeStats = await messagesQuery
      .select('msg.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .groupBy('msg.type')
      .getRawMany();

    return {
      totalConversations,
      activeConversations,
      totalMessages,
      dailyMessages,
      weeklyMessages,
      monthlyMessages,
      conversationsByType: conversationsByType.map(item => ({
        type: item.type,
        count: parseInt(item.count),
      })),
      conversationsByDepartment: conversationsByDepartment.map(item => ({
        department: item.department,
        count: parseInt(item.count),
      })),
      topActiveConversations: topActiveConversations.map(conv => ({
        id: conv.id,
        name: conv.name,
        messagesCount: conv.messagesCount,
        participantsCount: conv.participantsCount,
        lastActivity: conv.lastMessageAt,
      })),
      topActiveUsers: [], // À implémenter
      messageTypeStats: messageTypeStats.map(item => ({
        type: item.type,
        count: parseInt(item.count),
        percentage: (parseInt(item.count) / totalMessages) * 100,
      })),
      averageResponseTime: 0, // À implémenter
      averageConversationDuration: 0, // À implémenter
    };
  }

  // MÉTHODES PRIVÉES

  private async findExistingDirectConversation(userId1: string, userId2: string): Promise<Conversation | null> {
    const conversation = await this.conversationRepository
      .createQueryBuilder('conv')
      .leftJoin('conv.participants', 'p1')
      .leftJoin('conv.participants', 'p2')
      .where('conv.type = :type', { type: ConversationType.DIRECT })
      .andWhere('conv.isActive = true')
      .andWhere('p1.userId = :userId1 AND p1.isActive = true', { userId1 })
      .andWhere('p2.userId = :userId2 AND p2.isActive = true', { userId2 })
      .getOne();

    return conversation;
  }

  private generateConversationName(type: ConversationType, user: IUser): string {
    switch (type) {
      case ConversationType.DIRECT:
        return 'Conversation directe';
      case ConversationType.GROUP:
        return `Groupe de ${user.fullName}`;
      case ConversationType.DEPARTMENT:
        return `${user.department} - Discussion`;
      case ConversationType.ANNOUNCEMENT:
        return 'Annonces';
      default:
        return 'Nouvelle conversation';
    }
  }

  private async addParticipant(conversationId: string, data: Partial<Participant>): Promise<Participant> {
    const participant = this.participantRepository.create({
      conversationId,
      ...data,
      isActive: true,
      canSendMessages: data.canSendMessages ?? true,
      canAddParticipants: data.canAddParticipants ?? false,
      canDeleteMessages: data.canDeleteMessages ?? false,
    });

    return await this.participantRepository.save(participant);
  }

  private async getParticipant(conversationId: string, userId: string): Promise<Participant | null> {
    return await this.participantRepository.findOne({
      where: { conversationId, userId, isActive: true },
    });
  }

  private canManageConversation(participant: Participant, user: IUser): boolean {
    return participant.role === 'owner' || 
           participant.role === 'admin' || 
           user.roles.includes(Role.SUPER_ADMIN) || 
           user.roles.includes(Role.ADMIN);
  }

  private canModerateContent(user: IUser): boolean {
    return user.roles.includes(Role.SUPER_ADMIN) || 
           user.roles.includes(Role.ADMIN) || 
           user.roles.includes(Role.AGENT_EY);
  }

  private isPersonalUpdate(dto: UpdateParticipantDto): boolean {
    // Vérifier si la mise à jour ne concerne que des paramètres personnels
    return !dto.role && !dto.canSendMessages && !dto.canAddParticipants && !dto.canDeleteMessages;
  }

  private extractMentions(content: string, additionalMentions: string[] = []): string[] {
    const mentionRegex = /@(\w+)/g;
    const matches = content.match(mentionRegex) || [];
    const extractedMentions = matches.map(match => match.substring(1));
    return [...new Set([...extractedMentions, ...additionalMentions])];
  }

  private async updateUnreadCounts(conversationId: string, senderId: string): Promise<void> {
    // Incrémenter le compteur de messages non lus pour tous les participants sauf l'expéditeur
    await this.participantRepository
      .createQueryBuilder()
      .update(Participant)
      .set({ unreadCount: () => 'unreadCount + 1' })
      .where('conversationId = :conversationId', { conversationId })
      .andWhere('userId != :senderId', { senderId })
      .andWhere('isActive = true')
      .execute();
  }

  private async createMessageStatuses(message: Message): Promise<void> {
    // Créer les statuts de message pour tous les participants
    const participants = await this.participantRepository.find({
      where: { conversationId: message.conversationId, isActive: true },
    });

    const statuses = participants.map(participant => 
      this.messageStatusRepository.create({
        messageId: message.id,
        userId: participant.userId,
        userName: participant.userName,
        status: participant.userId === message.senderId ? 'read' : 'sent',
        deliveredAt: new Date(),
        readAt: participant.userId === message.senderId ? new Date() : undefined,
      })
    );

    await this.messageStatusRepository.save(statuses);
  }

  private async notifyMessageRecipients(message: Message, sender: IUser): Promise<void> {
    const participants = await this.participantRepository.find({
      where: { 
        conversationId: message.conversationId, 
        isActive: true,
        userId: Not(sender.id),
      },
    });

    for (const participant of participants) {
      // Ne pas notifier si l'utilisateur a coupé les notifications
      if (participant.isMuted) continue;

      await this.notificationsService.createNotification({
        type: NotificationType.MESSAGE_RECEIVED,
        title: `Message de ${sender.fullName}`,
        content: message.content.length > 100 
          ? message.content.substring(0, 100) + '...' 
          : message.content,
        userId: participant.userId,
        senderId: sender.id,
        senderName: sender.fullName,
        targetId: message.conversationId,
        targetType: 'conversation',
        actionUrl: `/chat/conversations/${message.conversationId}`,
        data: {
          conversationId: message.conversationId,
          messageId: message.id,
          messageType: message.type,
        },
      });
    }
  }


  private async recalculateUnreadCount(conversationId: string, userId: string): Promise<void> {
    const participant = await this.getParticipant(conversationId, userId);
    if (!participant) return;

    let unreadCount = 0;

    if (participant.lastMessageReadId) {
      const lastReadMessage = await this.messageRepository.findOne({
        where: { id: participant.lastMessageReadId },
      });

      if (lastReadMessage) {
        unreadCount = await this.messageRepository.count({
          where: {
            conversationId,
            isDeleted: false,
            createdAt: { $gt: lastReadMessage.createdAt } as any,
          },
        });
      }
    } else {
      unreadCount = await this.messageRepository.count({
        where: {
          conversationId,
          isDeleted: false,
        },
      });
    }

    participant.unreadCount = unreadCount;
    await this.participantRepository.save(participant);
  }

  // MAPPERS

  private async mapConversationToDto(conversation: Conversation, user: IUser): Promise<ConversationDto> {
    const participant = await this.getParticipant(conversation.id, user.id);
    
    return {
      id: conversation.id,
      type: conversation.type,
      name: conversation.name,
      description: conversation.description,
      creatorId: conversation.creatorId,
      creatorName: conversation.creatorName,
      creatorProfilePicture: conversation.creatorProfilePicture,
      department: conversation.department,
      isActive: conversation.isActive,
      isPrivate: conversation.isPrivate,
      lastMessageAt: conversation.lastMessageAt,
      lastMessage: conversation.lastMessage,
      lastMessageById: conversation.lastMessageById,
      lastMessageByName: conversation.lastMessageByName,
      messagesCount: conversation.messagesCount,
      participantsCount: conversation.participantsCount,
      tags: conversation.tags,
      avatar: conversation.avatar,
      settings: conversation.settings,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      unreadCount: participant?.unreadCount || 0,
      lastSeenAt: participant?.lastSeenAt,
      userRole: participant?.role,
      isMuted: participant?.isMuted,
      canSendMessages: participant?.canSendMessages,
      canAddParticipants: participant?.canAddParticipants,
      canDeleteMessages: participant?.canDeleteMessages,
    };
  }

  private async mapMessageToDto(message: Message, user: IUser): Promise<MessageDto> {
    const messageStatus = await this.messageStatusRepository.findOne({
      where: { messageId: message.id, userId: user.id },
    });

    const participant = await this.getParticipant(message.conversationId, user.id);

    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderName: message.senderName,
      senderProfilePicture: message.senderProfilePicture,
      senderDepartment: message.senderDepartment,
      type: message.type,
      content: message.content,
      attachments: message.attachments,
      mentions: message.mentions,
      replyToId: message.replyToId,
      replyToContent: message.replyToContent,
      replyToSenderName: message.replyToSenderName,
      isEdited: message.isEdited,
      isDeleted: message.isDeleted,
      isSystem: message.isSystem,
      isPinned: message.isPinned,
      reactionsCount: message.reactionsCount,
      metadata: message.metadata,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      deletedAt: message.deletedAt,
      deletedById: message.deletedById,
      canEdit: message.senderId === user.id,
      canDelete: message.senderId === user.id || participant?.canDeleteMessages || this.canModerateContent(user),
      canReact: participant?.isActive,
      isRead: messageStatus?.status === 'read',
      deliveredAt: messageStatus?.deliveredAt,
      readAt: messageStatus?.readAt,
    };
  }

  private mapParticipantToDto(participant: Participant): ParticipantDto {
    return {
      id: participant.id,
      conversationId: participant.conversationId,
      userId: participant.userId,
      userName: participant.userName,
      userProfilePicture: participant.userProfilePicture,
      userDepartment: participant.userDepartment,
      role: participant.role,
      isActive: participant.isActive,
      isMuted: participant.isMuted,
      mutedUntil: participant.mutedUntil,
      canSendMessages: participant.canSendMessages,
      canAddParticipants: participant.canAddParticipants,
      canDeleteMessages: participant.canDeleteMessages,
      nickname: participant.nickname,
      joinedAt: participant.joinedAt,
      lastSeenAt: participant.lastSeenAt,
      unreadCount: participant.unreadCount,
      leftAt: participant.leftAt,
      invitedById: participant.invitedById,
      invitedByName: participant.invitedByName,
    };
  }

  private mapReactionToDto(reaction: MessageReaction): MessageReactionDto {
    return {
      id: reaction.id,
      type: reaction.type,
      userId: reaction.userId,
      userName: reaction.userName,
      userProfilePicture: reaction.userProfilePicture,
      userDepartment: reaction.userDepartment,
      messageId: reaction.messageId,
      createdAt: reaction.createdAt,
    };
  }
}