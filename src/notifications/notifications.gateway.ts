// src/notifications/notifications.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  WsException,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards, Logger, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { NotificationsService } from './notifications.service';

@WebSocketGateway({
  cors: {
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      'http://localhost:3000',
      'http://localhost:3001',
    ],
    credentials: true,
    methods: ['GET', 'POST'],
  },
  namespace: 'notifications',
  transports: ['websocket', 'polling'],
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private userSocketMap = new Map<string, Set<string>>();
  private notificationsService: NotificationsService;

  constructor(
    private readonly jwtService: JwtService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  // CORRECTION CRITIQUE : Injection du service après l'initialisation
  setNotificationsService(service: NotificationsService) {
    this.notificationsService = service;
  }

afterInit(server: Server) {
  this.logger.log('NotificationsGateway initialized');
  this.server = server;
}
  async handleConnection(socket: Socket) {
    try {
      this.logger.log(`New connection attempt: ${socket.id}`);
      
      const token = this.extractToken(socket);
      if (!token) {
        this.logger.warn(`No token provided for socket: ${socket.id}`);
        throw new WsException('Token manquant');
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET || 'your-secret-key',
      });
      
      const userId = payload.sub;
      const userRoles = payload.roles || [];

      this.logger.log(`User ${userId} connecting with roles: ${JSON.stringify(userRoles)}`);

      // Stocker les infos dans le socket
      socket.data.userId = userId;
      socket.data.roles = userRoles;
      socket.data.department = payload.department;
      socket.data.fullName = payload.fullName || payload.FullName || 'Utilisateur';

      // Joindre les rooms appropriées
      socket.join(`user:${userId}`);
      
      // Room par département
      if (payload.department) {
        socket.join(`department:${payload.department}`);
        this.logger.log(`User ${userId} joined department room: ${payload.department}`);
      }

      // Rooms par rôle
      userRoles.forEach(role => {
        socket.join(`role:${role}`);
        this.logger.log(`User ${userId} joined role room: ${role}`);
      });

      // Gestion des connexions multiples
      if (!this.userSocketMap.has(userId)) {
        this.userSocketMap.set(userId, new Set());
      }
      this.userSocketMap.get(userId).add(socket.id);

      // Mettre en cache la connexion dans Redis
      try {
        await this.cacheManager.set(
          `socket:${socket.id}`,
          { 
            userId, 
            roles: userRoles, 
            department: payload.department,
            fullName: payload.fullName || payload.FullName || 'Utilisateur',
            connectedAt: new Date().toISOString(),
          },
          3600,
        );
      } catch (cacheError) {
        this.logger.warn(`Failed to cache socket data: ${cacheError.message}`);
      }

      // Envoyer les notifications non lues
      if (this.notificationsService) {
        try {
          const unreadNotifications = await this.notificationsService.getUnreadNotifications(userId);
          const unreadCount = await this.notificationsService.getUnreadCount(userId);
          
          socket.emit('unread_notifications', unreadNotifications);
          socket.emit('unread_count', { count: unreadCount });
          
          this.logger.log(`Sent ${unreadNotifications.length} unread notifications to user ${userId}`);
        } catch (notifError) {
          this.logger.error(`Failed to send initial notifications: ${notifError.message}`);
        }
      } else {
        this.logger.warn('NotificationsService not available yet');
      }

      // Mettre à jour le statut en ligne
      await this.updateUserOnlineStatus(userId, true);

      // Confirmer la connexion
      socket.emit('connected', { 
        success: true, 
        userId,
        message: 'Connexion établie avec succès',
        rooms: [`user:${userId}`, `department:${payload.department}`, ...userRoles.map(r => `role:${r}`)],
      });

      this.logger.log(`User ${userId} connected successfully - Socket: ${socket.id}`);

    } catch (error) {
      this.logger.error(`Connection error for socket ${socket.id}: ${error.message}`);
      socket.emit('connection_error', { 
        message: 'Erreur de connexion', 
        error: error.message 
      });
      socket.disconnect();
    }
  }

  async handleDisconnect(socket: Socket) {
    const userId = socket.data?.userId;
    
    this.logger.log(`Socket ${socket.id} disconnecting, userId: ${userId}`);
    
    if (userId) {
      // Retirer de la map
      const userSockets = this.userSocketMap.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          this.userSocketMap.delete(userId);
          // Mettre à jour le statut hors ligne seulement si aucune connexion
          await this.updateUserOnlineStatus(userId, false);
          this.logger.log(`User ${userId} is now offline`);
        } else {
          this.logger.log(`User ${userId} still has ${userSockets.size} active connections`);
        }
      }

      // Supprimer du cache Redis
      try {
        await this.cacheManager.del(`socket:${socket.id}`);
      } catch (error) {
        this.logger.warn(`Failed to remove socket from cache: ${error.message}`);
      }
    }

    this.logger.log(`Socket ${socket.id} disconnected`);
  }

  @SubscribeMessage('mark_as_read')
  async handleMarkAsRead(
    @MessageBody() data: { notificationId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = socket.data.userId;
    
    if (!userId) {
      throw new WsException('Non authentifié');
    }

    try {
      if (!this.notificationsService) {
        throw new WsException('Service de notifications non disponible');
      }

      await this.notificationsService.markAsRead(data.notificationId, userId);
      
      // Notifier tous les sockets de l'utilisateur
      this.server.to(`user:${userId}`).emit('notification_read', {
        notificationId: data.notificationId,
      });

      // Mettre à jour le compteur
      const newCount = await this.notificationsService.getUnreadCount(userId);
      this.server.to(`user:${userId}`).emit('unread_count', { count: newCount });

      this.logger.log(`Notification ${data.notificationId} marked as read for user ${userId}`);
    } catch (error) {
      this.logger.error(`Error marking notification as read: ${error.message}`);
      socket.emit('error', { message: 'Erreur lors du marquage comme lu' });
    }
  }

  @SubscribeMessage('mark_all_as_read')
  async handleMarkAllAsRead(@ConnectedSocket() socket: Socket) {
    const userId = socket.data.userId;
    
    if (!userId) {
      throw new WsException('Non authentifié');
    }

    try {
      if (!this.notificationsService) {
        throw new WsException('Service de notifications non disponible');
      }

      await this.notificationsService.markAllAsRead(userId);
      
      this.server.to(`user:${userId}`).emit('all_notifications_read');
      this.server.to(`user:${userId}`).emit('unread_count', { count: 0 });

      this.logger.log(`All notifications marked as read for user ${userId}`);
    } catch (error) {
      this.logger.error(`Error marking all notifications as read: ${error.message}`);
      socket.emit('error', { message: 'Erreur lors du marquage de toutes les notifications' });
    }
  }

  @SubscribeMessage('get_unread_count')
  async handleGetUnreadCount(@ConnectedSocket() socket: Socket) {
    const userId = socket.data.userId;
    
    if (!userId) {
      throw new WsException('Non authentifié');
    }

    try {
      if (!this.notificationsService) {
        throw new WsException('Service de notifications non disponible');
      }

      const count = await this.notificationsService.getUnreadCount(userId);
      socket.emit('unread_count', { count });
    } catch (error) {
      this.logger.error(`Error getting unread count: ${error.message}`);
      socket.emit('error', { message: 'Erreur lors de la récupération du compteur' });
    }
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() socket: Socket) {
    socket.emit('pong', { timestamp: new Date().toISOString() });
  }

  // =============== MÉTHODES PUBLIQUES POUR ENVOYER DES NOTIFICATIONS ===============

  // Méthode pour envoyer une notification depuis le service
  async sendNotificationToUser(userId: string, notification: any) {
    try {
      this.logger.log(`Sending notification to user ${userId}: ${notification.title}`);
      
      const userSockets = this.userSocketMap.get(userId);
      if (userSockets && userSockets.size > 0) {
        this.server.to(`user:${userId}`).emit('new_notification', notification);
        
        // Mettre à jour le compteur seulement si le service est disponible
        if (this.notificationsService) {
          const unreadCount = await this.notificationsService.getUnreadCount(userId);
          this.server.to(`user:${userId}`).emit('unread_count', { count: unreadCount });
        }
        
        this.logger.log(`Notification sent successfully to user ${userId} (${userSockets.size} sockets)`);
      } else {
        this.logger.log(`User ${userId} is not connected, notification will be stored for later`);
      }
    } catch (error) {
      this.logger.error(`Error sending notification to user ${userId}: ${error.message}`);
    }
  }

  // Envoi à un département
  async sendNotificationToDepartment(department: string, notification: any) {
    try {
      this.logger.log(`Sending notification to department ${department}: ${notification.title}`);
      this.server.to(`department:${department}`).emit('new_notification', notification);
      this.logger.log(`Notification sent to department ${department}`);
    } catch (error) {
      this.logger.error(`Error sending notification to department ${department}: ${error.message}`);
    }
  }

  // Envoi à un rôle
  async sendNotificationToRole(role: string, notification: any) {
    try {
      this.logger.log(`Sending notification to role ${role}: ${notification.title}`);
      this.server.to(`role:${role}`).emit('new_notification', notification);
      this.logger.log(`Notification sent to role ${role}`);
    } catch (error) {
      this.logger.error(`Error sending notification to role ${role}: ${error.message}`);
    }
  }

  // Broadcast à tous les utilisateurs connectés
  async broadcastNotification(notification: any) {
    try {
      this.logger.log(`Broadcasting notification: ${notification.title}`);
      this.server.emit('new_notification', notification);
      this.logger.log('Notification broadcasted to all connected users');
    } catch (error) {
      this.logger.error(`Error broadcasting notification: ${error.message}`);
    }
  }

  // =============== MÉTHODES PRIVÉES ===============

  private extractToken(socket: Socket): string | null {
    // Essayer plusieurs méthodes d'extraction du token
    const authToken = socket.handshake.auth?.token;
    const headerAuth = socket.handshake.headers?.authorization;
    const queryToken = socket.handshake.query?.token;

    let token = authToken || headerAuth || queryToken;
    
    if (!token) {
      this.logger.warn('No authentication token found in socket handshake');
      return null;
    }

    // Convertir en string si c'est un array
    if (Array.isArray(token)) {
      token = token[0];
    }

    // Supprimer le préfixe "Bearer " si présent
    if (typeof token === 'string' && token.startsWith('Bearer ')) {
      token = token.substring(7);
    }

    this.logger.log(`Token extracted successfully, length: ${token?.length}`);
    return token as string;
  }

  private async updateUserOnlineStatus(userId: string, isOnline: boolean) {
    try {
      await this.cacheManager.set(
        `user:online:${userId}`,
        { 
          isOnline, 
          lastSeen: new Date().toISOString(),
          connectedSockets: isOnline ? (this.userSocketMap.get(userId)?.size || 0) : 0,
        },
        3600,
      );
    } catch (error) {
      this.logger.warn(`Failed to update user online status: ${error.message}`);
    }
  }

  // Méthode utilitaire pour obtenir les statistiques de connexion
  getConnectionStats() {
    const totalUsers = this.userSocketMap.size;
    const totalSockets = Array.from(this.userSocketMap.values())
      .reduce((sum, sockets) => sum + sockets.size, 0);
    
    return {
      totalUsers,
      totalSockets,
      averageSocketsPerUser: totalUsers > 0 ? (totalSockets / totalUsers).toFixed(2) : 0,
    };
  }
}