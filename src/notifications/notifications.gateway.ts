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
import { UseGuards, Logger, Inject } from '@nestjs/common';
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
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
    ],
    credentials: true,
    methods: ['GET', 'POST'],
  },
  namespace: 'notifications',
  transports: ['websocket', 'polling'],
  allowEIO3: true,
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private userSocketMap = new Map<string, Set<string>>();
  private notificationsService?: NotificationsService;

  constructor(
    private readonly jwtService: JwtService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

afterInit(server: Server) {
  this.logger.log('🚀 NotificationsGateway initialized successfully');
  this.logger.log(`🌐 WebSocket server listening on namespace: /notifications`);

  // Vérifiez si `server.engine` et `server.engine.opts` sont définis
  if (server.engine && server.engine.opts) {
    const corsOpts = server.engine.opts.cors;
    if (corsOpts && typeof corsOpts === 'object' && 'origin' in corsOpts) {
      this.logger.log(`🔗 CORS origins: ${JSON.stringify((corsOpts as any).origin)}`);
    } else {
      this.logger.log('🔗 CORS origins: [dynamic or delegate function]');
    }
  } else {
    this.logger.warn('⚠️ Server engine or CORS options are not available');
  }

  // Configuration supplémentaire pour gérer les erreurs de connexion
  if (server.engine && typeof server.engine.on === 'function') {
    server.engine.on('connection_error', (err) => {
      this.logger.error('Connection error:', err.req);
      this.logger.error('Error code:', err.code);
      this.logger.error('Error message:', err.message);
      this.logger.error('Error context:', err.context);
    });
  } else {
    this.logger.warn('⚠️ Server engine is not available or does not support "on" method');
  }

  // Configuration supplémentaire pour générer des IDs de socket personnalisés
  if (server.engine) {
    server.engine.generateId = () => {
      return 'ey-' + Math.random().toString(36).substr(2, 9);
    };
  }
}

  setNotificationsService(service: NotificationsService) {
    this.notificationsService = service;
    this.logger.log('🔗 NotificationsService connected to Gateway');
  }

  async handleConnection(socket: Socket) {
    try {
      this.logger.log(`🔌 New connection attempt: ${socket.id}`);
      this.logger.log(`🔍 Connection details:`, {
        socketId: socket.id,
        remoteAddress: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'],
        origin: socket.handshake.headers.origin,
        transport: socket.conn.transport.name,
      });

      // Extraction du token avec logging détaillé
      const token = this.extractToken(socket);
      if (!token) {
        this.logger.warn(`❌ No valid token provided for socket: ${socket.id}`);
        socket.emit('connection_error', { 
          message: 'Token d\'authentification manquant ou invalide',
          code: 'NO_TOKEN',
          debug: {
            auth: socket.handshake.auth,
            query: socket.handshake.query,
            headers: Object.keys(socket.handshake.headers),
          }
        });
        socket.disconnect();
        return;
      }

      this.logger.log(`🔑 Token extracted successfully for socket ${socket.id}, length: ${token.length}`);

      // Validation du token avec gestion d'erreur détaillée
      let payload: any;
      try {
        payload = await this.jwtService.verifyAsync(token, {
          secret: process.env.JWT_SECRET || 'ebX9KqiwE0TszNzMAv37XBgp0mNhJcHs-12345678901234567890123456789012',
        });
        this.logger.log(`✅ Token validated successfully for socket ${socket.id}`);
      } catch (tokenError) {
        this.logger.warn(`❌ Invalid token for socket ${socket.id}: ${tokenError.message}`);
        socket.emit('connection_error', { 
          message: 'Token d\'authentification invalide ou expiré',
          code: 'INVALID_TOKEN',
          error: tokenError.message,
        });
        socket.disconnect();
        return;
      }
      
      // Validation des claims requis
      if (!payload.sub || !payload.email) {
        this.logger.warn(`❌ Missing required claims for socket ${socket.id}`, {
          hasSub: !!payload.sub,
          hasEmail: !!payload.email,
          claims: Object.keys(payload),
        });
        socket.emit('connection_error', { 
          message: 'Token invalide - informations utilisateur manquantes',
          code: 'MISSING_CLAIMS'
        });
        socket.disconnect();
        return;
      }

      const userId = payload.sub;
      const userRoles = this.extractRoles(payload);
      const userDepartment = this.extractDepartment(payload);
      const userFullName = payload.fullName || payload.FullName || payload.name || 'Utilisateur';

      this.logger.log(`👤 User connecting:`, {
        userId,
        fullName: userFullName,
        department: userDepartment,
        roles: userRoles,
        socketId: socket.id,
      });

      // Stocker les infos dans le socket
      socket.data = {
        userId,
        roles: userRoles,
        department: userDepartment,
        fullName: userFullName,
        email: payload.email,
        profilePicture: payload.profilePicture || payload.ProfilePicture,
        connectedAt: new Date(),
      };

      // Joindre les rooms appropriées
      await socket.join(`user:${userId}`);
      this.logger.log(`📁 User ${userId} joined personal room`);
      
      // Room par département
      if (userDepartment) {
        await socket.join(`department:${userDepartment}`);
        this.logger.log(`📁 User ${userId} joined department room: ${userDepartment}`);
      }

      // Rooms par rôle
      for (const role of userRoles) {
        await socket.join(`role:${role}`);
        this.logger.log(`📁 User ${userId} joined role room: ${role}`);
      }

      // Gestion des connexions multiples
      if (!this.userSocketMap.has(userId)) {
        this.userSocketMap.set(userId, new Set());
      }
      this.userSocketMap.get(userId)!.add(socket.id);

      const socketCount = this.userSocketMap.get(userId)!.size;
      this.logger.log(`👥 User ${userId} now has ${socketCount} active connection(s)`);

      // Mettre en cache la connexion
      try {
        await this.cacheManager.set(
          `socket:${socket.id}`,
          { 
            userId, 
            roles: userRoles, 
            department: userDepartment,
            fullName: userFullName,
            email: payload.email,
            connectedAt: new Date().toISOString(),
          },
          3600,
        );
        
        await this.cacheManager.set(
          `user:online:${userId}`,
          { 
            isOnline: true,
            lastSeen: new Date().toISOString(),
            connectedSockets: socketCount,
            socketIds: Array.from(this.userSocketMap.get(userId)!),
          },
          3600,
        );
      } catch (cacheError) {
        this.logger.warn(`⚠️ Failed to cache socket data: ${cacheError.message}`);
      }

      // Envoyer les notifications non lues
      if (this.notificationsService) {
        try {
          const unreadNotifications = await this.notificationsService.getUnreadNotifications(userId);
          const unreadCount = await this.notificationsService.getUnreadCount(userId);
          
          socket.emit('unread_notifications', unreadNotifications);
          socket.emit('unread_count', { count: unreadCount });
          
          this.logger.log(`📬 Sent ${unreadNotifications.length} unread notifications to user ${userId}`);
        } catch (notifError) {
          this.logger.error(`❌ Failed to send initial notifications: ${notifError.message}`);
        }
      } else {
        this.logger.warn('⚠️ NotificationsService not available yet');
      }

      // Confirmer la connexion
      socket.emit('connected', { 
        success: true, 
        userId,
        fullName: userFullName,
        message: 'Connexion établie avec succès au système de notifications',
        rooms: [`user:${userId}`, `department:${userDepartment}`, ...userRoles.map(r => `role:${r}`)],
        socketId: socket.id,
        timestamp: new Date().toISOString(),
        serverInfo: {
          namespace: '/notifications',
          transports: ['websocket', 'polling'],
        }
      });

      this.logger.log(`🎉 User ${userId} (${userFullName}) connected successfully - Socket: ${socket.id}`);

    } catch (error) {
      this.logger.error(`💥 Connection error for socket ${socket.id}: ${error.message}`, error.stack);
      socket.emit('connection_error', { 
        message: 'Erreur interne de connexion', 
        error: error.message,
        code: 'INTERNAL_ERROR'
      });
      socket.disconnect();
    }
  }

  async handleDisconnect(socket: Socket) {
    const userId = socket.data?.userId;
    const userFullName = socket.data?.fullName || 'Unknown';
    
    this.logger.log(`🔌 Socket ${socket.id} disconnecting, userId: ${userId} (${userFullName})`);
    
    if (userId) {
      const userSockets = this.userSocketMap.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        
        if (userSockets.size === 0) {
          this.userSocketMap.delete(userId);
          await this.updateUserOnlineStatus(userId, false);
          this.logger.log(`😴 User ${userId} is now offline`);
        } else {
          this.logger.log(`👥 User ${userId} still has ${userSockets.size} active connection(s)`);
          await this.updateUserOnlineStatus(userId, true, userSockets.size);
        }
      }

      try {
        await this.cacheManager.del(`socket:${socket.id}`);
      } catch (error) {
        this.logger.warn(`⚠️ Failed to remove socket from cache: ${error.message}`);
      }
    }

    this.logger.log(`👋 Socket ${socket.id} disconnected`);
  }

  // Gestion des messages WebSocket
  @SubscribeMessage('mark_as_read')
  async handleMarkAsRead(
    @MessageBody() data: { notificationId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = socket.data?.userId;
    
    if (!userId) {
      throw new WsException('Non authentifié');
    }

    try {
      if (!this.notificationsService) {
        throw new WsException('Service de notifications non disponible');
      }

      await this.notificationsService.markAsRead(data.notificationId, userId);
      
      this.server.to(`user:${userId}`).emit('notification_read', {
        notificationId: data.notificationId,
      });

      const newCount = await this.notificationsService.getUnreadCount(userId);
      this.server.to(`user:${userId}`).emit('unread_count', { count: newCount });

      this.logger.log(`📖 Notification ${data.notificationId} marked as read for user ${userId}`);
    } catch (error) {
      this.logger.error(`❌ Error marking notification as read: ${error.message}`);
      socket.emit('error', { 
        message: 'Erreur lors du marquage comme lu',
        code: 'MARK_READ_ERROR'
      });
    }
  }

  @SubscribeMessage('mark_all_as_read')
  async handleMarkAllAsRead(@ConnectedSocket() socket: Socket) {
    const userId = socket.data?.userId;
    
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

      this.logger.log(`📖 All notifications marked as read for user ${userId}`);
    } catch (error) {
      this.logger.error(`❌ Error marking all notifications as read: ${error.message}`);
      socket.emit('error', { 
        message: 'Erreur lors du marquage de toutes les notifications',
        code: 'MARK_ALL_READ_ERROR'
      });
    }
  }

  @SubscribeMessage('get_unread_count')
  async handleGetUnreadCount(@ConnectedSocket() socket: Socket) {
    const userId = socket.data?.userId;
    
    if (!userId) {
      throw new WsException('Non authentifié');
    }

    try {
      if (!this.notificationsService) {
        throw new WsException('Service de notifications non disponible');
      }

      const count = await this.notificationsService.getUnreadCount(userId);
      socket.emit('unread_count', { count });
      
      this.logger.log(`🔢 Sent unread count ${count} to user ${userId}`);
    } catch (error) {
      this.logger.error(`❌ Error getting unread count: ${error.message}`);
      socket.emit('error', { 
        message: 'Erreur lors de la récupération du compteur',
        code: 'GET_COUNT_ERROR'
      });
    }
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() socket: Socket) {
    socket.emit('pong', { 
      timestamp: new Date().toISOString(),
      socketId: socket.id,
      userId: socket.data?.userId,
      serverStatus: 'healthy',
    });
  }

  @SubscribeMessage('get_connection_info')
  handleGetConnectionInfo(@ConnectedSocket() socket: Socket) {
    const userId = socket.data?.userId;
    const connectionInfo = {
      socketId: socket.id,
      userId,
      connectedAt: socket.data?.connectedAt,
      rooms: Array.from(socket.rooms),
      transport: socket.conn.transport.name,
      isConnected: socket.connected,
      serverTime: new Date().toISOString(),
    };
    
    socket.emit('connection_info', connectionInfo);
    this.logger.log(`ℹ️ Sent connection info to user ${userId}`);
  }

  // Méthodes publiques pour envoyer des notifications

  async sendNotificationToUser(userId: string, notification: any) {
    try {
      this.logger.log(`📧 Sending notification to user ${userId}: ${notification.title}`);
      
      const userSockets = this.userSocketMap.get(userId);
      if (userSockets && userSockets.size > 0) {
        this.server.to(`user:${userId}`).emit('new_notification', notification);
        
        if (this.notificationsService) {
          try {
            const unreadCount = await this.notificationsService.getUnreadCount(userId);
            this.server.to(`user:${userId}`).emit('unread_count', { count: unreadCount });
          } catch (countError) {
            this.logger.warn(`⚠️ Could not update unread count: ${countError.message}`);
          }
        }
        
        this.logger.log(`✅ Notification sent successfully to user ${userId} (${userSockets.size} socket(s))`);
        return true;
      } else {
        this.logger.log(`📴 User ${userId} is not connected, notification stored for later`);
        return false;
      }
    } catch (error) {
      this.logger.error(`❌ Error sending notification to user ${userId}: ${error.message}`, error.stack);
      return false;
    }
  }

  async sendNotificationToDepartment(department: string, notification: any) {
    try {
      this.logger.log(`📧 Sending notification to department ${department}: ${notification.title}`);
      this.server.to(`department:${department}`).emit('new_notification', notification);
      this.logger.log(`✅ Notification sent to department ${department}`);
    } catch (error) {
      this.logger.error(`❌ Error sending notification to department ${department}: ${error.message}`);
    }
  }

  async sendNotificationToRole(role: string, notification: any) {
    try {
      this.logger.log(`📧 Sending notification to role ${role}: ${notification.title}`);
      this.server.to(`role:${role}`).emit('new_notification', notification);
      this.logger.log(`✅ Notification sent to role ${role}`);
    } catch (error) {
      this.logger.error(`❌ Error sending notification to role ${role}: ${error.message}`);
    }
  }

  async broadcastNotification(notification: any) {
    try {
      this.logger.log(`📢 Broadcasting notification: ${notification.title}`);
      this.server.emit('new_notification', notification);
      this.logger.log('✅ Notification broadcasted to all connected users');
    } catch (error) {
      this.logger.error(`❌ Error broadcasting notification: ${error.message}`);
    }
  }

  // Méthodes privées

  private extractToken(socket: Socket): string | null {
    try {
      // 1. Essayer auth.token (recommandé)
      let token = socket.handshake.auth?.token;
      
      // 2. Essayer Authorization header
      if (!token) {
        const authHeader = socket.handshake.headers?.authorization;
        if (authHeader && typeof authHeader === 'string') {
          token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
        }
      }
      
      // 3. Essayer query parameter
      if (!token) {
        token = socket.handshake.query?.token;
      }

      // 4. Essayer dans les cookies
      if (!token) {
        const cookies = socket.handshake.headers?.cookie;
        if (cookies) {
          const cookieMatch = cookies.match(/ey-session=([^;]+)/);
          if (cookieMatch) {
            token = cookieMatch[1];
          }
        }
      }

      // Validation et nettoyage
      if (token) {
        if (Array.isArray(token)) {
          token = token[0];
        }
        
        if (typeof token === 'string' && token.startsWith('Bearer ')) {
          token = token.substring(7);
        }
        
        token = token?.toString().trim();
        if (!token) {
          return null;
        }

        this.logger.log(`✅ Token extracted successfully, length: ${token.length}`);
        return token;
      }

      this.logger.warn('❌ No authentication token found in any location');
      return null;
    } catch (error) {
      this.logger.error(`❌ Error extracting token: ${error.message}`);
      return null;
    }
  }

  private extractDepartment(payload: any): string {
    const dept = payload.department || 
                 payload.Department || 
                 payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/department'];
    
    if (!dept) {
      this.logger.warn('⚠️ Department not found in JWT payload');
      return 'Consulting';
    }

    const departmentMap: { [key: string]: string } = {
      'Assurance': 'Assurance',
      'Consulting': 'Consulting',
      'StrategyAndTransactions': 'StrategyAndTransactions',
      'Tax': 'Tax',
      'ASSURANCE': 'Assurance',
      'CONSULTING': 'Consulting',
      'STRATEGY_AND_TRANSACTIONS': 'StrategyAndTransactions',
      'TAX': 'Tax'
    };

    return departmentMap[dept] || 'Consulting';
  }

  private extractRoles(payload: any): string[] {
    const possibleRoleFields = [
      'role',
      'roles', 
      'Role',
      'Roles',
      'http://schemas.microsoft.com/ws/2008/06/identity/claims/role'
    ];

    for (const field of possibleRoleFields) {
      const roles = payload[field];
      if (roles) {
        return Array.isArray(roles) ? roles : [roles];
      }
    }

    const extractedRoles: string[] = [];
    Object.keys(payload).forEach(key => {
      if (key.toLowerCase().includes('role')) {
        const value = payload[key];
        if (Array.isArray(value)) {
          extractedRoles.push(...value);
        } else if (typeof value === 'string') {
          extractedRoles.push(value);
        }
      }
    });

    return extractedRoles.length > 0 ? extractedRoles : ['EmployeeEY'];
  }

  private async updateUserOnlineStatus(userId: string, isOnline: boolean, socketCount: number = 0) {
    try {
      await this.cacheManager.set(
        `user:online:${userId}`,
        { 
          isOnline, 
          lastSeen: new Date().toISOString(),
          connectedSockets: isOnline ? socketCount : 0,
          socketIds: isOnline ? Array.from(this.userSocketMap.get(userId) || []) : [],
        },
        3600,
      );
    } catch (error) {
      this.logger.warn(`⚠️ Failed to update user online status: ${error.message}`);
    }
  }

  // Méthodes utilitaires

  getConnectionStats() {
    const totalUsers = this.userSocketMap.size;
    const totalSockets = Array.from(this.userSocketMap.values())
      .reduce((sum, sockets) => sum + sockets.size, 0);
    
    return {
      totalUsers,
      totalSockets,
      averageSocketsPerUser: totalUsers > 0 ? Math.round((totalSockets / totalUsers) * 100) / 100 : 0,
      connectedUsers: Array.from(this.userSocketMap.keys()),
      uptime: process.uptime(),
    };
  }

  async forceUserReconnection(userId: string, reason: string = 'Server maintenance') {
    const userSockets = this.userSocketMap.get(userId);
    if (userSockets) {
      userSockets.forEach(socketId => {
        const socket = this.server.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('force_reconnect', { reason });
          socket.disconnect();
        }
      });
      this.logger.log(`🔄 Forced reconnection for user ${userId}: ${reason}`);
    }
  }

  // Méthode de diagnostic
  async getDiagnosticInfo() {
    const stats = this.getConnectionStats();
    let cacheKeysRaw = await this.cacheManager.stores.keys?.() || [];
    const cacheKeys = Array.isArray(cacheKeysRaw) ? cacheKeysRaw : Array.from(cacheKeysRaw as Iterable<any>);
    
    return {
      gateway: {
        status: 'running',
        namespace: '/notifications',
        connectedSockets: stats.totalSockets,
        connectedUsers: stats.totalUsers,
      },
      cache: {
        totalKeys: cacheKeys.length,
        socketKeys: cacheKeys.filter((key: any) => typeof key === 'string' && key.startsWith('socket:')).length,
        userKeys: cacheKeys.filter((key: any) => typeof key === 'string' && key.startsWith('user:online:')).length,
      },
      service: {
        hasNotificationsService: !!this.notificationsService,
        uptime: process.uptime(),
      },
    };
  }

  // Méthodes pour envoyer des notifications spécifiques depuis les services

  async notifyEventWorkflow(eventData: any, actionType: 'created' | 'approved' | 'rejected', actorId: string, actorName: string) {
    try {
      switch (actionType) {
        case 'created':
          await this.notificationsService?.notifyEventCreated(eventData, eventData.organizerId, eventData.organizerName, eventData.department);
          break;
        case 'approved':
          await this.notificationsService?.notifyEventApproved(eventData, actorId, actorName);
          break;
        case 'rejected':
          await this.notificationsService?.notifyEventRejected(eventData, actorId, actorName);
          break;
      }
    } catch (error) {
      this.logger.error(`💥 Error in notifyEventWorkflow: ${error.message}`, error.stack);
    }
  }

  async notifyJobWorkflow(jobData: any, actionType: 'application' | 'recommendation', applicantData: any) {
    try {
      switch (actionType) {
        case 'application':
          await this.notificationsService?.notifyJobApplication(jobData, applicantData.id, applicantData.name, applicantData.department);
          break;
        case 'recommendation':
          await this.notificationsService?.notifyJobRecommendation(jobData, applicantData.recommenderId, applicantData.recommenderName, applicantData.candidateName);
          break;
      }
    } catch (error) {
      this.logger.error(`💥 Error in notifyJobWorkflow: ${error.message}`, error.stack);
    }
  }

  async notifySocialActivity(activityType: 'mention' | 'comment' | 'reaction', activityData: any) {
    try {
      switch (activityType) {
        case 'mention':
          await this.notificationsService?.notifyPostMention(
            activityData.post, 
            activityData.mentionedUserId, 
            activityData.mentionedUserName, 
            activityData.authorName
          );
          break;
        case 'comment':
          await this.notificationsService?.notifyPostComment(
            activityData.post,
            activityData.commentAuthorId,
            activityData.commentAuthorName,
            activityData.postAuthorId,
            activityData.postAuthorName
          );
          break;
      }
    } catch (error) {
      this.logger.error(`💥 Error in notifySocialActivity: ${error.message}`, error.stack);
    }
  }
}