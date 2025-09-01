import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards, Logger, Injectable } from '@nestjs/common';
import { WsAuthGuard } from '../shared/guards/ws-auth.guard';
import { Department } from 'src/shared/enums/department.enum';
import { TypingDto } from './dto/typing.dto';
import { JoinRoomDto, LeaveRoomDto, MarkAsReadDto, VoiceCallDto } from './dto/websocket-events.dto';

interface AuthenticatedSocket extends Socket {
  user: {
    id: string;
    email: string;
    fullName: string;
    department: Department;
    roles: string[];
    profilePicture?: string;
  };
}

interface OnlineUser {
  id: string;
  fullName: string;
  profilePicture?: string;
  department: Department;
  socketIds: string[];
  lastSeen: Date;
  status: 'online' | 'away' | 'busy' | 'offline';
}

interface TypingUser {
  userId: string;
  userName: string;
  timestamp: Date;
}

@Injectable()
@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: process.env.WS_CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  
  // Gestion des utilisateurs en ligne
  private onlineUsers = new Map<string, OnlineUser>();
  
  // Gestion des utilisateurs en train de taper
  private typingUsers = new Map<string, Map<string, TypingUser>>(); // conversationId -> userId -> TypingUser
  
  // Gestion des appels vocaux/vidéo
  private activeCalls = new Map<string, {
    conversationId: string;
    callId: string;
    type: 'voice' | 'video';
    initiator: string;
    participants: string[];
    startedAt: Date;
  }>();

  afterInit(server: Server) {
    this.logger.log('💬 Chat WebSocket Gateway initialized');
    
    // Nettoyer les utilisateurs qui tapent toutes les 30 secondes
    setInterval(() => {
      this.cleanupTypingUsers();
    }, 30000);

    // Nettoyer les utilisateurs hors ligne toutes les 5 minutes
    setInterval(() => {
      this.cleanupOfflineUsers();
    }, 300000);
  }

  @UseGuards(WsAuthGuard)
  async handleConnection(client: AuthenticatedSocket) {
    try {
      const userId = client.user.id;
      
      this.logger.log(`Chat: User ${client.user.fullName} connected`);

      // Ajouter l'utilisateur à la liste des utilisateurs en ligne
      this.addOnlineUser(client);

      // Joindre le client à sa room personnelle
      await client.join(`user-${userId}`);
      
      // Joindre à la room de son département
      await client.join(`department-${client.user.department}`);

      // Joindre aux rooms de ses rôles pour les annonces
      for (const role of client.user.roles) {
        await client.join(`role-${role}`);
      }

      // Envoyer le statut en ligne aux contacts
      await this.broadcastUserOnlineStatus(userId, true);

      // Envoyer la liste des utilisateurs en ligne
      client.emit('online_users', Array.from(this.onlineUsers.values()));

      // Envoyer les appels en cours pour l'utilisateur
      await this.sendActiveCallsToUser(client);

    } catch (error) {
      this.logger.error('Error in chat handleConnection:', error);
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    try {
      if (!client.user) return;

      const userId = client.user.id;
      
      this.logger.log(`Chat: User ${client.user.fullName} disconnected`);

      // Retirer l'utilisateur de la liste des utilisateurs en ligne
      this.removeOnlineUser(client);

      // Arrêter le "typing" pour toutes les conversations
      await this.stopTypingInAllConversations(userId);

      // Si l'utilisateur n'a plus de connexions actives, le marquer comme hors ligne
      const onlineUser = this.onlineUsers.get(userId);
      if (!onlineUser || onlineUser.socketIds.length === 0) {
        await this.broadcastUserOnlineStatus(userId, false);
      }

    } catch (error) {
      this.logger.error('Error in chat handleDisconnect:', error);
    }
  }

  // GESTION DES CONVERSATIONS ET ROOMS

  @SubscribeMessage('join_conversation')
  @UseGuards(WsAuthGuard)
  async handleJoinConversation(
    @MessageBody() data: JoinRoomDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      // Vérifier que l'utilisateur a accès à cette conversation
      // Cette vérification devrait être faite via le ChatService
      await client.join(`conversation-${data.conversationId}`);
      
      client.emit('joined_conversation', {
        conversationId: data.conversationId,
        timestamp: new Date(),
      });

      // Notifier les autres participants que l'utilisateur a rejoint
      client.to(`conversation-${data.conversationId}`).emit('user_joined_conversation', {
        conversationId: data.conversationId,
        userId: client.user.id,
        userName: client.user.fullName,
        timestamp: new Date(),
      });

      this.logger.log(`User ${client.user.fullName} joined conversation ${data.conversationId}`);
    } catch (error) {
      this.logger.error('Error joining conversation:', error);
      client.emit('error', { message: 'Failed to join conversation' });
    }
  }

  @SubscribeMessage('leave_conversation')
  @UseGuards(WsAuthGuard)
  async handleLeaveConversation(
    @MessageBody() data: LeaveRoomDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      await client.leave(`conversation-${data.conversationId}`);
      
      // Arrêter le typing dans cette conversation
      await this.stopTyping(data.conversationId, client.user.id);

      client.emit('left_conversation', {
        conversationId: data.conversationId,
        timestamp: new Date(),
      });

      // Notifier les autres participants
      client.to(`conversation-${data.conversationId}`).emit('user_left_conversation', {
        conversationId: data.conversationId,
        userId: client.user.id,
        userName: client.user.fullName,
        timestamp: new Date(),
      });

      this.logger.log(`User ${client.user.fullName} left conversation ${data.conversationId}`);
    } catch (error) {
      this.logger.error('Error leaving conversation:', error);
      client.emit('error', { message: 'Failed to leave conversation' });
    }
  }

  // GESTION DU TYPING

  @SubscribeMessage('typing_start')
  @UseGuards(WsAuthGuard)
  async handleTypingStart(
    @MessageBody() data: TypingDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      await this.startTyping(data.conversationId, client.user.id, client.user.fullName);
      
      // Notifier les autres participants
      client.to(`conversation-${data.conversationId}`).emit('user_typing_start', {
        conversationId: data.conversationId,
        userId: client.user.id,
        userName: client.user.fullName,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error('Error handling typing start:', error);
    }
  }

  @SubscribeMessage('typing_stop')
  @UseGuards(WsAuthGuard)
  async handleTypingStop(
    @MessageBody() data: TypingDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      await this.stopTyping(data.conversationId, client.user.id);
      
      // Notifier les autres participants
      client.to(`conversation-${data.conversationId}`).emit('user_typing_stop', {
        conversationId: data.conversationId,
        userId: client.user.id,
        userName: client.user.fullName,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error('Error handling typing stop:', error);
    }
  }

  // GESTION DES STATUTS DE LECTURE

  @SubscribeMessage('mark_as_read')
  @UseGuards(WsAuthGuard)
  async handleMarkAsRead(
    @MessageBody() data: MarkAsReadDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      // Cette logique devrait être déléguée au ChatService
      // Pour l'instant, on notifie juste les autres participants
      client.to(`conversation-${data.conversationId}`).emit('message_read', {
        conversationId: data.conversationId,
        messageId: data.messageId,
        userId: client.user.id,
        userName: client.user.fullName,
        readAt: new Date(),
      });
    } catch (error) {
      this.logger.error('Error handling mark as read:', error);
      client.emit('error', { message: 'Failed to mark message as read' });
    }
  }

  // GESTION DES APPELS VOCAUX/VIDÉO

  @SubscribeMessage('voice_call')
  @UseGuards(WsAuthGuard)
  async handleVoiceCall(
    @MessageBody() data: VoiceCallDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      switch (data.action) {
        case 'start':
          await this.startCall(client, data);
          break;
        case 'accept':
          await this.acceptCall(client, data);
          break;
        case 'decline':
          await this.declineCall(client, data);
          break;
        case 'end':
          await this.endCall(client, data);
          break;
      }
    } catch (error) {
      this.logger.error('Error handling voice call:', error);
      client.emit('call_error', { message: 'Call operation failed' });
    }
  }

  // GESTION DU STATUT EN LIGNE

  @SubscribeMessage('update_status')
  @UseGuards(WsAuthGuard)
  async handleUpdateStatus(
    @MessageBody() data: { status: 'online' | 'away' | 'busy' },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      const onlineUser = this.onlineUsers.get(client.user.id);
      if (onlineUser) {
        onlineUser.status = data.status;
        onlineUser.lastSeen = new Date();

        // Notifier tous les contacts de l'utilisateur
        await this.broadcastUserStatusUpdate(client.user.id, data.status);
      }
    } catch (error) {
      this.logger.error('Error updating status:', error);
    }
  }

  // MÉTHODES PUBLIQUES POUR NOTIFIER DEPUIS LE SERVICE

  async notifyMessageSent(conversationId: string, message: any) {
    this.server.to(`conversation-${conversationId}`).emit('new_message', {
      conversationId,
      message,
      timestamp: new Date(),
    });
  }

  async notifyMessageUpdated(conversationId: string, message: any) {
    this.server.to(`conversation-${conversationId}`).emit('message_updated', {
      conversationId,
      message,
      timestamp: new Date(),
    });
  }

  async notifyMessageDeleted(conversationId: string, messageId: string) {
    this.server.to(`conversation-${conversationId}`).emit('message_deleted', {
      conversationId,
      messageId,
      timestamp: new Date(),
    });
  }

  async notifyMessageRead(conversationId: string, messageId: string, userId: string) {
    this.server.to(`conversation-${conversationId}`).emit('message_read', {
      conversationId,
      messageId,
      userId,
      timestamp: new Date(),
    });
  }

  async notifyConversationRead(conversationId: string, userId: string) {
    this.server.to(`conversation-${conversationId}`).emit('conversation_read', {
      conversationId,
      userId,
      timestamp: new Date(),
    });
  }

  async notifyConversationCreated(conversationId: string, conversation: any) {
    // Notifier les participants de la nouvelle conversation
    if (conversation.participants) {
      for (const participant of conversation.participants) {
        this.server.to(`user-${participant.userId}`).emit('conversation_created', {
          conversation,
          timestamp: new Date(),
        });
      }
    }
  }

  async notifyConversationUpdated(conversationId: string, conversation: any) {
    this.server.to(`conversation-${conversationId}`).emit('conversation_updated', {
      conversation,
      timestamp: new Date(),
    });
  }

  async notifyConversationDeleted(conversationId: string) {
    this.server.to(`conversation-${conversationId}`).emit('conversation_deleted', {
      conversationId,
      timestamp: new Date(),
    });
  }

  async notifyParticipantAdded(conversationId: string, participant: any) {
    this.server.to(`conversation-${conversationId}`).emit('participant_added', {
      conversationId,
      participant,
      timestamp: new Date(),
    });

    // Notifier le nouveau participant
    this.server.to(`user-${participant.userId}`).emit('added_to_conversation', {
      conversationId,
      timestamp: new Date(),
    });
  }

  async notifyParticipantRemoved(conversationId: string, participantId: string) {
    this.server.to(`conversation-${conversationId}`).emit('participant_removed', {
      conversationId,
      participantId,
      timestamp: new Date(),
    });

    // Notifier le participant retiré
    this.server.to(`user-${participantId}`).emit('removed_from_conversation', {
      conversationId,
      timestamp: new Date(),
    });
  }

  async notifyParticipantUpdated(conversationId: string, participant: any) {
    this.server.to(`conversation-${conversationId}`).emit('participant_updated', {
      conversationId,
      participant,
      timestamp: new Date(),
    });
  }

  async notifyReactionAdded(conversationId: string, reaction: any) {
    this.server.to(`conversation-${conversationId}`).emit('reaction_added', {
      conversationId,
      reaction,
      timestamp: new Date(),
    });
  }

  async notifyReactionRemoved(conversationId: string, messageId: string, userId: string) {
    this.server.to(`conversation-${conversationId}`).emit('reaction_removed', {
      conversationId,
      messageId,
      userId,
      timestamp: new Date(),
    });
  }

  async notifyReactionUpdated(conversationId: string, reaction: any) {
    this.server.to(`conversation-${conversationId}`).emit('reaction_updated', {
      conversationId,
      reaction,
      timestamp: new Date(),
    });
  }

  // MÉTHODES PRIVÉES

  private addOnlineUser(client: AuthenticatedSocket) {
    const userId = client.user.id;
    const existingUser = this.onlineUsers.get(userId);

    if (existingUser) {
      // Utilisateur déjà en ligne, ajouter le socket ID
      existingUser.socketIds.push(client.id);
      existingUser.lastSeen = new Date();
      existingUser.status = 'online';
    } else {
      // Nouvel utilisateur en ligne
      this.onlineUsers.set(userId, {
        id: userId,
        fullName: client.user.fullName,
        profilePicture: client.user.profilePicture,
        department: client.user.department,
        socketIds: [client.id],
        lastSeen: new Date(),
        status: 'online',
      });
    }
  }

  private removeOnlineUser(client: AuthenticatedSocket) {
    const userId = client.user.id;
    const onlineUser = this.onlineUsers.get(userId);

    if (onlineUser) {
      // Retirer le socket ID
      const index = onlineUser.socketIds.indexOf(client.id);
      if (index > -1) {
        onlineUser.socketIds.splice(index, 1);
      }

      // Si plus de connexions, retirer l'utilisateur ou le marquer comme hors ligne
      if (onlineUser.socketIds.length === 0) {
        onlineUser.status = 'offline';
        onlineUser.lastSeen = new Date();
        // On peut garder l'utilisateur quelques minutes pour éviter les va-et-vient
      }
    }
  }

  private async startTyping(conversationId: string, userId: string, userName: string) {
    if (!this.typingUsers.has(conversationId)) {
      this.typingUsers.set(conversationId, new Map());
    }

    const conversationTyping = this.typingUsers.get(conversationId)!;
    conversationTyping.set(userId, {
      userId,
      userName,
      timestamp: new Date(),
    });
  }

  private async stopTyping(conversationId: string, userId: string) {
    const conversationTyping = this.typingUsers.get(conversationId);
    if (conversationTyping) {
      conversationTyping.delete(userId);
      
      if (conversationTyping.size === 0) {
        this.typingUsers.delete(conversationId);
      }
    }
  }

  private async stopTypingInAllConversations(userId: string) {
    for (const [conversationId, conversationTyping] of this.typingUsers.entries()) {
      if (conversationTyping.has(userId)) {
        conversationTyping.delete(userId);
        
        // Notifier que l'utilisateur a arrêté de taper
        this.server.to(`conversation-${conversationId}`).emit('user_typing_stop', {
          conversationId,
          userId,
          timestamp: new Date(),
        });

        if (conversationTyping.size === 0) {
          this.typingUsers.delete(conversationId);
        }
      }
    }
  }

  private cleanupTypingUsers() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    for (const [conversationId, conversationTyping] of this.typingUsers.entries()) {
      for (const [userId, typingUser] of conversationTyping.entries()) {
        if (typingUser.timestamp < fiveMinutesAgo) {
          conversationTyping.delete(userId);
          
          // Notifier que l'utilisateur a arrêté de taper
          this.server.to(`conversation-${conversationId}`).emit('user_typing_stop', {
            conversationId,
            userId,
            timestamp: new Date(),
          });
        }
      }

      if (conversationTyping.size === 0) {
        this.typingUsers.delete(conversationId);
      }
    }
  }

  private cleanupOfflineUsers() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    for (const [userId, user] of this.onlineUsers.entries()) {
      if (user.socketIds.length === 0 && user.lastSeen < fiveMinutesAgo) {
        this.onlineUsers.delete(userId);
      }
    }
  }

  private async broadcastUserOnlineStatus(userId: string, isOnline: boolean) {
    const onlineUser = this.onlineUsers.get(userId);
    if (!onlineUser) return;

    // Notifier tous les utilisateurs connectés du changement de statut
    this.server.emit('user_status_changed', {
      userId,
      fullName: onlineUser.fullName,
      isOnline,
      status: onlineUser.status,
      lastSeen: onlineUser.lastSeen,
      timestamp: new Date(),
    });
  }

  private async broadcastUserStatusUpdate(userId: string, status: string) {
    const onlineUser = this.onlineUsers.get(userId);
    if (!onlineUser) return;

    this.server.emit('user_status_changed', {
      userId,
      fullName: onlineUser.fullName,
      isOnline: true,
      status,
      lastSeen: onlineUser.lastSeen,
      timestamp: new Date(),
    });
  }

  // GESTION DES APPELS

  private async startCall(client: AuthenticatedSocket, data: VoiceCallDto) {
    const callId = `call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const call = {
      conversationId: data.conversationId,
      callId,
      type: data.callData?.type || 'voice',
      initiator: client.user.id,
      participants: [client.user.id],
      startedAt: new Date(),
    };

    this.activeCalls.set(callId, call);

    // Notifier les participants de la conversation
    client.to(`conversation-${data.conversationId}`).emit('incoming_call', {
      callId,
      conversationId: data.conversationId,
      type: call.type,
      initiatorId: client.user.id,
      initiatorName: client.user.fullName,
      timestamp: new Date(),
    });

    client.emit('call_started', {
      callId,
      conversationId: data.conversationId,
      type: call.type,
    });
  }

  private async acceptCall(client: AuthenticatedSocket, data: VoiceCallDto) {
    const call = this.activeCalls.get(data.callData?.callId || '');
    if (!call) {
      client.emit('call_error', { message: 'Call not found' });
      return;
    }

    call.participants.push(client.user.id);

    // Notifier tous les participants
    this.server.to(`conversation-${call.conversationId}`).emit('call_accepted', {
      callId: call.callId,
      userId: client.user.id,
      userName: client.user.fullName,
      participants: call.participants,
      timestamp: new Date(),
    });
  }

  private async declineCall(client: AuthenticatedSocket, data: VoiceCallDto) {
    const call = this.activeCalls.get(data.callData?.callId || '');
    if (!call) return;

    // Notifier l'initiateur
    this.server.to(`user-${call.initiator}`).emit('call_declined', {
      callId: call.callId,
      userId: client.user.id,
      userName: client.user.fullName,
      timestamp: new Date(),
    });
  }

  private async endCall(client: AuthenticatedSocket, data: VoiceCallDto) {
    const call = this.activeCalls.get(data.callData?.callId || '');
    if (!call) return;

    // Notifier tous les participants
    this.server.to(`conversation-${call.conversationId}`).emit('call_ended', {
      callId: call.callId,
      endedBy: client.user.id,
      endedByName: client.user.fullName,
      duration: Date.now() - call.startedAt.getTime(),
      timestamp: new Date(),
    });

    // Supprimer l'appel
    this.activeCalls.delete(call.callId);
  }

  private async sendActiveCallsToUser(client: AuthenticatedSocket) {
    const userCalls = Array.from(this.activeCalls.values()).filter(call =>
      call.participants.includes(client.user.id)
    );

    if (userCalls.length > 0) {
      client.emit('active_calls', userCalls);
    }
  }

  // MÉTHODES UTILITAIRES

  getOnlineUsersCount(): number {
    return this.onlineUsers.size;
  }

  getOnlineUsersByDepartment(department: Department): OnlineUser[] {
    return Array.from(this.onlineUsers.values()).filter(user => 
      user.department === department && user.socketIds.length > 0
    );
  }

  isUserOnline(userId: string): boolean {
    const user = this.onlineUsers.get(userId);
    return user ? user.socketIds.length > 0 : false;
  }

  getTypingUsers(conversationId: string): TypingUser[] {
    const conversationTyping = this.typingUsers.get(conversationId);
    return conversationTyping ? Array.from(conversationTyping.values()) : [];
  }

  getActiveCalls(): any[] {
    return Array.from(this.activeCalls.values());
  }
}