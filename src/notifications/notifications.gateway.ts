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
import { UseGuards, Logger, Optional } from '@nestjs/common';
import { WsAuthGuard } from '../shared/guards/ws-auth.guard';
import { NotificationsService } from './notifications.service';

interface AuthenticatedSocket extends Socket {
  user: {
    id: string;
    email: string;
    fullName: string;
    department: string;
    roles: string[];
  };
}

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: process.env.WS_CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  },
})
export class NotificationsGateway 
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private connectedUsers = new Map<string, AuthenticatedSocket[]>();

constructor(
  @Optional() private notificationsService?: NotificationsService,
) {}

  afterInit(server: Server) {
    this.logger.log('🔔 Notifications WebSocket Gateway initialized');
  }

  @UseGuards(WsAuthGuard)
  async handleConnection(client: AuthenticatedSocket) {
    try {
      const userId = client.user.id;
      
      // Ajouter le client à la liste des connexions de l'utilisateur
      if (!this.connectedUsers.has(userId)) {
        this.connectedUsers.set(userId, []);
      }
      this.connectedUsers.get(userId)!.push(client);

      // Joindre le client à sa room personnelle
      await client.join(`user-${userId}`);
      
      // Joindre à la room de son département pour les notifications globales
      await client.join(`department-${client.user.department}`);

      // Joindre aux rooms de ses rôles
      for (const role of client.user.roles) {
        await client.join(`role-${role}`);
      }

      this.logger.log(`User ${client.user.fullName} connected to notifications`);

      // Envoyer les notifications non lues
      await this.sendUnreadNotifications(client);

      // Notifier les autres clients que l'utilisateur est en ligne
      client.broadcast.emit('user_online', {
        userId: client.user.id,
        fullName: client.user.fullName,
      });

    } catch (error) {
      this.logger.error('Error in handleConnection:', error);
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    try {
      const userId = client.user?.id;
      
      if (userId) {
        // Retirer le client de la liste des connexions
        const userConnections = this.connectedUsers.get(userId);
        if (userConnections) {
          const index = userConnections.indexOf(client);
          if (index > -1) {
            userConnections.splice(index, 1);
          }
          
          // Si plus de connexions pour cet utilisateur, le retirer complètement
          if (userConnections.length === 0) {
            this.connectedUsers.delete(userId);
            
            // Notifier que l'utilisateur est hors ligne
            client.broadcast.emit('user_offline', {
              userId: client.user.id,
              fullName: client.user.fullName,
            });
          }
        }

        this.logger.log(`User ${client.user.fullName} disconnected from notifications`);
      }
    } catch (error) {
      this.logger.error('Error in handleDisconnect:', error);
    }
  }

  @SubscribeMessage('mark_notification_read')
  @UseGuards(WsAuthGuard)
  async handleMarkAsRead(
    @MessageBody() data: { notificationId: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      await this.notificationsService.markAsRead(data.notificationId, client.user.id);
      
      client.emit('notification_updated', {
        notificationId: data.notificationId,
        isRead: true,
      });
    } catch (error) {
      this.logger.error('Error marking notification as read:', error);
      client.emit('error', { message: 'Failed to mark notification as read' });
    }
  }

  @SubscribeMessage('mark_all_read')
  @UseGuards(WsAuthGuard)
  async handleMarkAllAsRead(@ConnectedSocket() client: AuthenticatedSocket) {
    try {
      await this.notificationsService.markAllAsRead(client.user.id);
      
      client.emit('all_notifications_read');
    } catch (error) {
      this.logger.error('Error marking all notifications as read:', error);
      client.emit('error', { message: 'Failed to mark all notifications as read' });
    }
  }

  @SubscribeMessage('delete_notification')
  @UseGuards(WsAuthGuard)
  async handleDeleteNotification(
    @MessageBody() data: { notificationId: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      await this.notificationsService.deleteNotification(data.notificationId, client.user.id);
      
      client.emit('notification_deleted', {
        notificationId: data.notificationId,
      });
    } catch (error) {
      this.logger.error('Error deleting notification:', error);
      client.emit('error', { message: 'Failed to delete notification' });
    }
  }

  @SubscribeMessage('get_unread_count')
  @UseGuards(WsAuthGuard)
  async handleGetUnreadCount(@ConnectedSocket() client: AuthenticatedSocket) {
    try {
      const count = await this.notificationsService.getUnreadCount(client.user.id);
      
      client.emit('unread_count', { count });
    } catch (error) {
      this.logger.error('Error getting unread count:', error);
      client.emit('error', { message: 'Failed to get unread count' });
    }
  }

  // Méthodes publiques pour envoyer des notifications

  async sendNotificationToUser(userId: string, notification: any) {
    const userConnections = this.connectedUsers.get(userId);
    
    if (userConnections && userConnections.length > 0) {
      for (const client of userConnections) {
        client.emit('new_notification', notification);
      }
    }
    
    // Envoyer aussi dans la room de l'utilisateur au cas où
    this.server.to(`user-${userId}`).emit('new_notification', notification);
  }

  async sendNotificationUpdate(userId: string, update: any) {
    const userConnections = this.connectedUsers.get(userId);
    
    if (userConnections && userConnections.length > 0) {
      for (const client of userConnections) {
        client.emit('notification_updated', update);
      }
    }
  }

  async sendNotificationToDepartment(department: string, notification: any) {
    this.server.to(`department-${department}`).emit('new_notification', notification);
  }

  async sendNotificationToRole(role: string, notification: any) {
    this.server.to(`role-${role}`).emit('new_notification', notification);
  }

  async sendSystemAnnouncement(announcement: any) {
    this.server.emit('system_announcement', announcement);
  }

  // Méthodes privées

  private async sendUnreadNotifications(client: AuthenticatedSocket) {
    try {
      const { notifications, unreadCount } = await this.notificationsService.getUserNotifications(
        client.user.id,
        1,
        10,
        true // unreadOnly
      );

      client.emit('initial_notifications', {
        notifications,
        unreadCount,
      });
    } catch (error) {
      this.logger.error('Error sending unread notifications:', error);
    }
  }

  // Méthodes utilitaires

  getConnectedUsersCount(): number {
    return this.connectedUsers.size;
  }

  getConnectedUsersByDepartment(department: string): number {
    return this.server.sockets.adapter.rooms.get(`department-${department}`)?.size || 0;
  }

  isUserOnline(userId: string): boolean {
    return this.connectedUsers.has(userId);
  }

  getOnlineUsers(): { userId: string; fullName: string }[] {
    const onlineUsers: { userId: string; fullName: string }[] = [];
    
    for (const [userId, connections] of this.connectedUsers.entries()) {
      if (connections.length > 0) {
        onlineUsers.push({
          userId,
          fullName: connections[0].user.fullName,
        });
      }
    }
    
    return onlineUsers;
  }
}
