// src/notifications/notifications.service.ts
import { Injectable, Logger, NotFoundException, ForbiddenException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull } from 'typeorm';
import { Notification, NotificationType, NotificationPriority } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationsGateway } from './notifications.gateway';
import { Cron, CronExpression } from '@nestjs/schedule';

import { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private gateway: NotificationsGateway;

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepository: Repository<NotificationPreference>,
  ) {}

  onModuleInit() {
    this.logger.log('NotificationsService initialized');
  }

  setGateway(gateway: NotificationsGateway) {
    this.gateway = gateway;
    // CORRECTION CRITIQUE : Connecter le service au gateway aussi
    if (gateway && typeof gateway.setNotificationsService === 'function') {
      gateway.setNotificationsService(this);
    }
    this.logger.log('Gateway connected to NotificationsService');
  }

  async createNotification(dto: CreateNotificationDto): Promise<Notification> {
    try {
      this.logger.log(`Creating notification for user ${dto.recipientId}: ${dto.title}`);

      // Vérifier les préférences de l'utilisateur
      const preferences = await this.getUserPreferences(dto.recipientId);
      
      if (preferences?.doNotDisturb && !this.isUrgent(dto.priority)) {
        if (this.isInDoNotDisturbSchedule(preferences.doNotDisturbSchedule)) {
          this.logger.log(`Notification delayed due to DND for user ${dto.recipientId}`);
          // Pour l'instant, on crée quand même la notification mais on ne l'envoie pas en temps réel
        }
      }

      const notification = this.notificationRepository.create({
        ...dto,
        createdAt: new Date(),
      });

      const savedNotification = await this.notificationRepository.save(notification);
      this.logger.log(`Notification saved to database: ${savedNotification.id}`);

      // Envoyer via WebSocket
      if (this.gateway) {
        try {
          await this.gateway.sendNotificationToUser(dto.recipientId, savedNotification);
          this.logger.log(`Notification sent via WebSocket to user ${dto.recipientId}`);
        } catch (gatewayError) {
          this.logger.error(`Failed to send notification via WebSocket: ${gatewayError.message}`);
        }
      } else {
        this.logger.warn('Gateway not available, notification saved but not sent via WebSocket');
      }

      // Si c'est urgent, envoyer aussi par email (TODO: intégrer service email)
      if (dto.priority === NotificationPriority.URGENT) {
        this.logger.log(`Urgent notification - should send email to ${dto.recipientId}`);
        // TODO: Intégrer avec le service email
      }

      return savedNotification;
    } catch (error) {
      this.logger.error(`Error creating notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createBulkNotifications(
    recipients: string[],
    notificationData: Omit<CreateNotificationDto, 'recipientId' | 'recipientName'>,
    recipientNames: Map<string, string>,
  ): Promise<void> {
    try {
      this.logger.log(`Creating bulk notifications for ${recipients.length} recipients`);

      const notifications = recipients.map(recipientId => 
        this.notificationRepository.create({
          ...notificationData,
          recipientId,
          recipientName: recipientNames.get(recipientId) || 'Utilisateur',
          createdAt: new Date(),
        })
      );

      const savedNotifications = await this.notificationRepository.save(notifications);
      this.logger.log(`${savedNotifications.length} bulk notifications saved to database`);

      // Envoyer via WebSocket à chaque utilisateur
      if (this.gateway) {
        let successCount = 0;
        for (const notification of savedNotifications) {
          try {
            await this.gateway.sendNotificationToUser(notification.recipientId, notification);
            successCount++;
          } catch (gatewayError) {
            this.logger.error(`Failed to send notification via WebSocket to user ${notification.recipientId}: ${gatewayError.message}`);
          }
        }
        this.logger.log(`${successCount}/${savedNotifications.length} bulk notifications sent via WebSocket`);
      } else {
        this.logger.warn('Gateway not available, bulk notifications saved but not sent via WebSocket');
      }
    } catch (error) {
      this.logger.error(`Error creating bulk notifications: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getUserNotifications(
    userId: string,
    page: number = 1,
    limit: number = 20,
    filters?: {
      isRead?: boolean;
      type?: NotificationType;
      priority?: NotificationPriority;
    },
  ) {
    try {
      const query = this.notificationRepository
        .createQueryBuilder('notification')
        .where('notification.recipientId = :userId', { userId })
        .andWhere('notification.isArchived = :isArchived', { isArchived: false });

      if (filters?.isRead !== undefined) {
        query.andWhere('notification.isRead = :isRead', { isRead: filters.isRead });
      }

      if (filters?.type) {
        query.andWhere('notification.type = :type', { type: filters.type });
      }

      if (filters?.priority) {
        query.andWhere('notification.priority = :priority', { priority: filters.priority });
      }

      query
        .orderBy('notification.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [notifications, total] = await query.getManyAndCount();

      return {
        notifications,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      this.logger.error(`Error getting user notifications: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getUnreadNotifications(userId: string): Promise<Notification[]> {
    try {
      return await this.notificationRepository.find({
        where: {
          recipientId: userId,
          isRead: false,
          isArchived: false,
        },
        order: {
          createdAt: 'DESC',
        },
        take: 50, // Limiter à 50 notifications non lues
      });
    } catch (error) {
      this.logger.error(`Error getting unread notifications: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getUnreadCount(userId: string): Promise<number> {
    try {
      return await this.notificationRepository.count({
        where: {
          recipientId: userId,
          isRead: false,
          isArchived: false,
        },
      });
    } catch (error) {
      this.logger.error(`Error getting unread count: ${error.message}`, error.stack);
      return 0; // Retourner 0 en cas d'erreur
    }
  }

  async markAsRead(notificationId: string, userId: string): Promise<void> {
    try {
      const notification = await this.notificationRepository.findOne({
        where: { id: notificationId, recipientId: userId },
      });

      if (!notification) {
        throw new NotFoundException('Notification non trouvée');
      }

      notification.isRead = true;
      notification.readAt = new Date();
      
      await this.notificationRepository.save(notification);
      this.logger.log(`Notification ${notificationId} marked as read for user ${userId}`);
    } catch (error) {
      this.logger.error(`Error marking notification as read: ${error.message}`, error.stack);
      throw error;
    }
  }

  async markAllAsRead(userId: string): Promise<void> {
    try {
      const result = await this.notificationRepository.update(
        { recipientId: userId, isRead: false },
        { isRead: true, readAt: new Date() },
      );
      this.logger.log(`${result.affected} notifications marked as read for user ${userId}`);
    } catch (error) {
      this.logger.error(`Error marking all notifications as read: ${error.message}`, error.stack);
      throw error;
    }
  }

  async archiveNotification(notificationId: string, userId: string): Promise<void> {
    try {
      const notification = await this.notificationRepository.findOne({
        where: { id: notificationId, recipientId: userId },
      });

      if (!notification) {
        throw new NotFoundException('Notification non trouvée');
      }

      notification.isArchived = true;
      await this.notificationRepository.save(notification);
      this.logger.log(`Notification ${notificationId} archived for user ${userId}`);
    } catch (error) {
      this.logger.error(`Error archiving notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    try {
      const result = await this.notificationRepository.delete({
        id: notificationId,
        recipientId: userId,
      });

      if (result.affected === 0) {
        throw new NotFoundException('Notification non trouvée');
      }
      this.logger.log(`Notification ${notificationId} deleted for user ${userId}`);
    } catch (error) {
      this.logger.error(`Error deleting notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getUserPreferences(userId: string): Promise<NotificationPreference | null> {
    try {
      let preferences = await this.preferenceRepository.findOne({
        where: { userId },
      });

      if (!preferences) {
        // Créer des préférences par défaut
        preferences = this.preferenceRepository.create({
          userId,
          emailEnabled: true,
          pushEnabled: true,
          emailPreferences: this.getDefaultPreferences(),
          pushPreferences: this.getDefaultPreferences(),
        });
        
        await this.preferenceRepository.save(preferences);
        this.logger.log(`Default preferences created for user ${userId}`);
      }

      return preferences;
    } catch (error) {
      this.logger.error(`Error getting user preferences: ${error.message}`, error.stack);
      return null;
    }
  }

  async updateUserPreferences(
    userId: string,
    preferences: Partial<NotificationPreference>,
  ): Promise<NotificationPreference> {
    try {
      const existingPreferences = await this.getUserPreferences(userId);
      
      const updated = await this.preferenceRepository.save({
        ...existingPreferences,
        ...preferences,
        userId, // S'assurer que l'userId ne change pas
      });

      this.logger.log(`Preferences updated for user ${userId}`);
      return updated;
    } catch (error) {
      this.logger.error(`Error updating user preferences: ${error.message}`, error.stack);
      throw error;
    }
  }

  // Méthodes utilitaires pour créer des notifications spécifiques

  async notifyEventCreated(event: any, creatorId: string) {
    try {
      const notification: CreateNotificationDto = {
        type: NotificationType.EVENT_CREATED,
        title: 'Nouvel événement créé',
        message: `${event.organizerName} a créé l'événement "${event.title}"`,
        priority: NotificationPriority.MEDIUM,
        recipientId: '', // Sera défini dans la boucle
        recipientName: '', // Sera défini dans la boucle
        metadata: {
          entityId: event.id,
          entityType: 'event',
          actionUrl: `/events/${event.id}`,
          actorId: creatorId,
          actorName: event.organizerName,
          department: event.department,
        },
      };

      // TODO: Récupérer les admins et agents depuis la DB et créer les notifications
      this.logger.log('Event created notification ready - need to implement admin/agent lookup');
    } catch (error) {
      this.logger.error(`Error in notifyEventCreated: ${error.message}`, error.stack);
    }
  }

  async notifyPostMention(post: any, mentionedUserId: string, authorName: string) {
    try {
      await this.createNotification({
        type: NotificationType.POST_MENTION,
        title: 'Vous avez été mentionné',
        message: `${authorName} vous a mentionné dans une publication`,
        priority: NotificationPriority.MEDIUM,
        recipientId: mentionedUserId,
        recipientName: '', // À récupérer
        metadata: {
          entityId: post.id,
          entityType: 'post',
          actionUrl: `/social/posts/${post.id}`,
          actorId: post.authorId,
          actorName: authorName,
        },
      });
    } catch (error) {
      this.logger.error(`Error in notifyPostMention: ${error.message}`, error.stack);
    }
  }

  async notifyContentFlagged(flag: any, moderatorIds: string[]) {
    try {
      const notification = {
        type: NotificationType.CONTENT_FLAGGED,
        title: 'Contenu signalé',
        message: `Un contenu a été signalé: ${flag.reason}`,
        priority: flag.isUrgent ? NotificationPriority.URGENT : NotificationPriority.HIGH,
        metadata: {
          entityId: flag.targetId,
          entityType: flag.targetType,
          actionUrl: `/admin/flagged-content/${flag.id}`,
          actorId: flag.reportedById,
          actorName: flag.reportedByName,
        },
      };

      // Créer les notifications pour tous les modérateurs
      const recipientNames = new Map<string, string>(); // À remplir avec les vrais noms
      await this.createBulkNotifications(moderatorIds, notification, recipientNames);
    } catch (error) {
      this.logger.error(`Error in notifyContentFlagged: ${error.message}`, error.stack);
    }
  }

  // Nettoyage automatique des anciennes notifications
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanupOldNotifications() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Supprimer les notifications lues de plus de 30 jours
      const result = await this.notificationRepository.delete({
        isRead: true,
        createdAt: LessThan(thirtyDaysAgo),
      });

      this.logger.log(`Cleaned up ${result.affected} old notifications`);
    } catch (error) {
      this.logger.error(`Error cleaning up notifications: ${error.message}`, error.stack);
    }
  }

  // Helpers privés

  private getDefaultPreferences(): Record<NotificationType, boolean> {
    const preferences: Partial<Record<NotificationType, boolean>> = {};
    
    // Activer toutes les notifications par défaut
    Object.values(NotificationType).forEach(type => {
      preferences[type] = true;
    });

    return preferences as Record<NotificationType, boolean>;
  }

  private isUrgent(priority: NotificationPriority): boolean {
    return priority === NotificationPriority.URGENT;
  }

  private isInDoNotDisturbSchedule(schedule?: any): boolean {
    if (!schedule) return false;

    try {
      const now = new Date();
      const currentTime = now.toLocaleTimeString('fr-FR', { 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: schedule.timezone || 'UTC',
      });

      return currentTime >= schedule.start && currentTime <= schedule.end;
    } catch (error) {
      this.logger.error(`Error checking DND schedule: ${error.message}`);
      return false;
    }
  }

  // Méthode de diagnostic pour tester les notifications
  async testNotificationSystem(userId: string, userName: string): Promise<boolean> {
    try {
      this.logger.log(`Testing notification system for user ${userId}`);
      
      const testNotification = await this.createNotification({
        recipientId: userId,
        recipientName: userName,
        type: NotificationType.WELCOME,
        title: 'Test de notification',
        message: 'Ceci est un test du système de notifications',
        priority: NotificationPriority.LOW,
        metadata: {
          entityId: 'test',
          entityType: 'system',
          actionUrl: '/test',
        },
      });

      this.logger.log(`Test notification created successfully: ${testNotification.id}`);
      return true;
    } catch (error) {
      this.logger.error(`Test notification failed: ${error.message}`, error.stack);
      return false;
    }
  }
}