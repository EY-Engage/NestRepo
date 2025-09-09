import { Injectable, Logger, NotFoundException, ForbiddenException, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull, In } from 'typeorm';
import { Notification, NotificationType, NotificationPriority } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationsGateway } from './notifications.gateway';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreateNotificationDto, NotificationDataDto } from './dto/create-notification.dto';
import { User } from '../social/posts/entities/user.entity';
import { Role } from '../shared/enums/role.enum';
import { Department } from '../shared/enums/department.enum';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private gateway: NotificationsGateway;

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepository: Repository<NotificationPreference>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  onModuleInit() {
    this.logger.log('✅ NotificationsService initialized');
  }

  setGateway(gateway: NotificationsGateway) {
    this.gateway = gateway;
    this.logger.log('🔗 Gateway connected to NotificationsService');
  }

  async createNotification(dto: CreateNotificationDto): Promise<Notification> {
    try {
      this.logger.log(`📧 Creating notification for user ${dto.recipientId}: ${dto.title}`);

      // Vérifier que l'utilisateur existe
      const user = await this.userRepository.findOne({
        where: { id: dto.recipientId }
      });

      if (!user) {
        this.logger.warn(`⚠️ User ${dto.recipientId} not found, skipping notification`);
        throw new NotFoundException(`Utilisateur ${dto.recipientId} non trouvé`);
      }

      // Vérifier les préférences de l'utilisateur
      const preferences = await this.getUserPreferences(dto.recipientId);
      
      if (preferences?.doNotDisturb && !this.isUrgent(dto.priority)) {
        if (this.isInDoNotDisturbSchedule(preferences.doNotDisturbSchedule)) {
          this.logger.log(`⏰ Notification delayed due to DND for user ${dto.recipientId}`);
        }
      }

      const notification = this.notificationRepository.create({
        ...dto,
        createdAt: new Date(),
      });

      const savedNotification = await this.notificationRepository.save(notification);
      this.logger.log(`💾 Notification saved to database: ${savedNotification.id}`);

      // Envoyer via WebSocket immédiatement
      if (this.gateway) {
        try {
          const sent = await this.gateway.sendNotificationToUser(dto.recipientId, savedNotification);
          if (sent) {
            this.logger.log(`🚀 Notification sent via WebSocket to user ${dto.recipientId}`);
          } else {
            this.logger.log(`📴 User ${dto.recipientId} not connected, notification stored for later`);
          }
        } catch (gatewayError) {
          this.logger.error(`❌ Failed to send notification via WebSocket: ${gatewayError.message}`);
        }
      } else {
        this.logger.warn('⚠️ Gateway not available, notification saved but not sent via WebSocket');
      }

      return savedNotification;
    } catch (error) {
      this.logger.error(`💥 Error creating notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createBulkNotifications(
    recipients: string[],
    notificationData: NotificationDataDto,
    recipientNames: Map<string, string>,
  ): Promise<void> {
    try {
      this.logger.log(`📬 Creating bulk notifications for ${recipients.length} recipients`);

      // Vérifier que tous les utilisateurs existent
      const existingUsers = await this.userRepository.find({
        where: { id: In(recipients) },
        select: ['id', 'fullName', 'isActive']
      });

      const existingUserIds = existingUsers.map(u => u.id);
      const missingUsers = recipients.filter(id => !existingUserIds.includes(id));
      
      if (missingUsers.length > 0) {
        this.logger.warn(`⚠️ ${missingUsers.length} users not found: ${missingUsers.join(', ')}`);
      }

      // Créer les notifications seulement pour les utilisateurs existants et actifs
      const activeUsers = existingUsers.filter(u => u.isActive);
      const notifications = activeUsers.map(user => 
        this.notificationRepository.create({
          ...notificationData,
          recipientId: user.id,
          recipientName: recipientNames.get(user.id) || user.fullName,
          createdAt: new Date(),
        })
      );

      const savedNotifications = await this.notificationRepository.save(notifications);
      this.logger.log(`💾 ${savedNotifications.length} bulk notifications saved to database`);

      // Envoyer via WebSocket à chaque utilisateur
      if (this.gateway) {
        let successCount = 0;
        for (const notification of savedNotifications) {
          try {
            const sent = await this.gateway.sendNotificationToUser(notification.recipientId, notification);
            if (sent) successCount++;
          } catch (gatewayError) {
            this.logger.error(`❌ Failed to send notification via WebSocket to user ${notification.recipientId}: ${gatewayError.message}`);
          }
        }
        this.logger.log(`🚀 ${successCount}/${savedNotifications.length} bulk notifications sent via WebSocket`);
      } else {
        this.logger.warn('⚠️ Gateway not available, bulk notifications saved but not sent via WebSocket');
      }
    } catch (error) {
      this.logger.error(`💥 Error creating bulk notifications: ${error.message}`, error.stack);
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
      this.logger.error(`💥 Error getting user notifications: ${error.message}`, error.stack);
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
      this.logger.error(`💥 Error getting unread notifications: ${error.message}`, error.stack);
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
      this.logger.error(`💥 Error getting unread count: ${error.message}`, error.stack);
      return 0;
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
      this.logger.log(`✅ Notification ${notificationId} marked as read for user ${userId}`);
    } catch (error) {
      this.logger.error(`💥 Error marking notification as read: ${error.message}`, error.stack);
      throw error;
    }
  }

  async markAllAsRead(userId: string): Promise<void> {
    try {
      const result = await this.notificationRepository.update(
        { recipientId: userId, isRead: false },
        { isRead: true, readAt: new Date() },
      );
      this.logger.log(`✅ ${result.affected} notifications marked as read for user ${userId}`);
    } catch (error) {
      this.logger.error(`💥 Error marking all notifications as read: ${error.message}`, error.stack);
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
      notification.archivedAt = new Date();
      await this.notificationRepository.save(notification);
      this.logger.log(`📁 Notification ${notificationId} archived for user ${userId}`);
    } catch (error) {
      this.logger.error(`💥 Error archiving notification: ${error.message}`, error.stack);
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
      this.logger.log(`🗑️ Notification ${notificationId} deleted for user ${userId}`);
    } catch (error) {
      this.logger.error(`💥 Error deleting notification: ${error.message}`, error.stack);
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
        this.logger.log(`🔧 Default preferences created for user ${userId}`);
      }

      return preferences;
    } catch (error) {
      this.logger.error(`💥 Error getting user preferences: ${error.message}`, error.stack);
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
        userId,
      });

      this.logger.log(`🔧 Preferences updated for user ${userId}`);
      return updated;
    } catch (error) {
      this.logger.error(`💥 Error updating user preferences: ${error.message}`, error.stack);
      throw error;
    }
  }

  // Méthodes spécialisées pour les différents types de notifications

  async notifyEventCreated(eventData: any, organizerId: string, organizerName: string, organizerDepartment: string) {
    try {
      this.logger.log(`🎉 Notifying event created: ${eventData.title} by ${organizerName}`);

      // Notification pour l'organisateur
      await this.createNotification({
        type: NotificationType.EVENT_CREATED,
        title: 'Événement créé avec succès',
        message: `Votre événement "${eventData.title}" a été créé et est en attente d'approbation`,
        priority: NotificationPriority.MEDIUM,
        recipientId: organizerId,
        recipientName: organizerName,
        metadata: {
          entityId: eventData.id,
          entityType: 'event',
          actionUrl: `/EyEngage/EmployeeDashboard/events/${eventData.id}`,
          actorId: organizerId,
          actorName: organizerName,
          department: organizerDepartment,
        },
      });

      // Notifier les admins et agents du département
      await this.notifyAdminsAndAgents(organizerDepartment, {
        type: NotificationType.EVENT_CREATED,
        title: 'Nouvel événement à approuver',
        message: `${organizerName} a créé l'événement "${eventData.title}"`,
        priority: NotificationPriority.HIGH,
        metadata: {
          entityId: eventData.id,
          entityType: 'event',
          actionUrl: `/EyEngage/SupervisorDashboard/events/manage`,
          actorId: organizerId,
          actorName: organizerName,
          department: organizerDepartment,
        },
      });
    } catch (error) {
      this.logger.error(`💥 Error in notifyEventCreated: ${error.message}`, error.stack);
    }
  }

  async notifyEventApproved(eventData: any, approverId: string, approverName: string) {
    try {
      await this.createNotification({
        type: NotificationType.EVENT_APPROVED,
        title: 'Événement approuvé',
        message: `Votre événement "${eventData.title}" a été approuvé par ${approverName}`,
        priority: NotificationPriority.HIGH,
        recipientId: eventData.organizerId,
        recipientName: eventData.organizerName,
        metadata: {
          entityId: eventData.id,
          entityType: 'event',
          actionUrl: `/EyEngage/EmployeeDashboard/events/${eventData.id}`,
          actorId: approverId,
          actorName: approverName,
          department: eventData.department,
        },
      });
    } catch (error) {
      this.logger.error(`💥 Error in notifyEventApproved: ${error.message}`, error.stack);
    }
  }

  async notifyEventRejected(eventData: any, rejectorId: string, rejectorName: string) {
    try {
      await this.createNotification({
        type: NotificationType.EVENT_REJECTED,
        title: 'Événement refusé',
        message: `Votre événement "${eventData.title}" a été refusé par ${rejectorName}`,
        priority: NotificationPriority.HIGH,
        recipientId: eventData.organizerId,
        recipientName: eventData.organizerName,
        metadata: {
          entityId: eventData.id,
          entityType: 'event',
          actionUrl: `/EyEngage/EmployeeDashboard/events/${eventData.id}`,
          actorId: rejectorId,
          actorName: rejectorName,
          department: eventData.department,
        },
      });
    } catch (error) {
      this.logger.error(`💥 Error in notifyEventRejected: ${error.message}`, error.stack);
    }
  }

  async notifyParticipationRequest(eventData: any, participantId: string, participantName: string, participantDepartment: string) {
    try {
      // Notifier l'organisateur
      await this.createNotification({
        type: NotificationType.EVENT_PARTICIPATION_REQUEST,
        title: 'Nouvelle demande de participation',
        message: `${participantName} souhaite participer à votre événement "${eventData.title}"`,
        priority: NotificationPriority.MEDIUM,
        recipientId: eventData.organizerId,
        recipientName: eventData.organizerName,
        metadata: {
          entityId: eventData.id,
          entityType: 'event',
          actionUrl: `/EyEngage/SupervisorDashboard/events/manage`,
          actorId: participantId,
          actorName: participantName,
          department: participantDepartment,
        },
      });

      // Notifier les admins/agents du département de l'événement
      await this.notifyAdminsAndAgents(eventData.department, {
        type: NotificationType.EVENT_PARTICIPATION_REQUEST,
        title: 'Nouvelle demande de participation',
        message: `${participantName} souhaite participer à "${eventData.title}"`,
        priority: NotificationPriority.MEDIUM,
        metadata: {
          entityId: eventData.id,
          entityType: 'event',
          actionUrl: `/EyEngage/SupervisorDashboard/events/manage`,
          actorId: participantId,
          actorName: participantName,
          department: participantDepartment,
        },
      });
    } catch (error) {
      this.logger.error(`💥 Error in notifyParticipationRequest: ${error.message}`, error.stack);
    }
  }

  async notifyParticipationApproved(eventData: any, participantId: string, participantName: string, approverId: string, approverName: string) {
    try {
      await this.createNotification({
        type: NotificationType.EVENT_PARTICIPATION_APPROVED,
        title: 'Participation approuvée',
        message: `Votre participation à "${eventData.title}" a été approuvée par ${approverName}`,
        priority: NotificationPriority.HIGH,
        recipientId: participantId,
        recipientName: participantName,
        metadata: {
          entityId: eventData.id,
          entityType: 'event',
          actionUrl: `/EyEngage/EmployeeDashboard/events/${eventData.id}`,
          actorId: approverId,
          actorName: approverName,
          department: eventData.department,
        },
      });
    } catch (error) {
      this.logger.error(`💥 Error in notifyParticipationApproved: ${error.message}`, error.stack);
    }
  }

  async notifyJobApplication(jobData: any, applicantId: string, applicantName: string, applicantDepartment: string) {
    try {
      // Notifier les RH du département
      await this.notifyAdminsAndAgents(jobData.department, {
        type: NotificationType.JOB_APPLICATION,
        title: 'Nouvelle candidature',
        message: `${applicantName} a postulé pour "${jobData.title}"`,
        priority: NotificationPriority.HIGH,
        metadata: {
          entityId: jobData.id,
          entityType: 'job',
          actionUrl: `/EyEngage/SupervisorDashboard/career`,
          actorId: applicantId,
          actorName: applicantName,
          department: applicantDepartment,
        },
      });
    } catch (error) {
      this.logger.error(`💥 Error in notifyJobApplication: ${error.message}`, error.stack);
    }
  }

  async notifyJobRecommendation(jobData: any, recommenderId: string, recommenderName: string, candidateName: string) {
    try {
      // Notifier les RH du département
      await this.notifyAdminsAndAgents(jobData.department, {
        type: NotificationType.JOB_RECOMMENDATION,
        title: 'Nouvelle recommandation',
        message: `${recommenderName} a recommandé ${candidateName} pour "${jobData.title}"`,
        priority: NotificationPriority.HIGH,
        metadata: {
          entityId: jobData.id,
          entityType: 'job',
          actionUrl: `/EyEngage/SupervisorDashboard/career`,
          actorId: recommenderId,
          actorName: recommenderName,
          department: jobData.department,
        },
      });
    } catch (error) {
      this.logger.error(`💥 Error in notifyJobRecommendation: ${error.message}`, error.stack);
    }
  }

  async notifyPostMention(postData: any, mentionedUserId: string, mentionedUserName: string, authorName: string) {
    try {
      await this.createNotification({
        type: NotificationType.POST_MENTION,
        title: 'Vous avez été mentionné',
        message: `${authorName} vous a mentionné dans une publication`,
        priority: NotificationPriority.MEDIUM,
        recipientId: mentionedUserId,
        recipientName: mentionedUserName,
        metadata: {
          entityId: postData.id,
          entityType: 'post',
          actionUrl: `/EyEngage/EmployeeDashboard/social`,
          actorId: postData.authorId,
          actorName: authorName,
          department: postData.department,
        },
      });
    } catch (error) {
      this.logger.error(`💥 Error in notifyPostMention: ${error.message}`, error.stack);
    }
  }

  async notifyPostComment(postData: any, commentAuthorId: string, commentAuthorName: string, postAuthorId: string, postAuthorName: string) {
    try {
      // Ne pas notifier si l'auteur du commentaire est le même que l'auteur du post
      if (commentAuthorId === postAuthorId) return;

      await this.createNotification({
        type: NotificationType.POST_COMMENT,
        title: 'Nouveau commentaire',
        message: `${commentAuthorName} a commenté votre publication`,
        priority: NotificationPriority.MEDIUM,
        recipientId: postAuthorId,
        recipientName: postAuthorName,
        metadata: {
          entityId: postData.id,
          entityType: 'post',
          actionUrl: `/EyEngage/EmployeeDashboard/social`,
          actorId: commentAuthorId,
          actorName: commentAuthorName,
          department: postData.department,
        },
      });
    } catch (error) {
      this.logger.error(`💥 Error in notifyPostComment: ${error.message}`, error.stack);
    }
  }

  async notifyContentFlagged(flagData: any, moderatorIds: string[]) {
    try {
      const notification = {
        type: NotificationType.CONTENT_FLAGGED,
        title: 'Contenu signalé',
        message: `Un contenu a été signalé: ${flagData.reason}`,
        priority: flagData.isUrgent ? NotificationPriority.URGENT : NotificationPriority.HIGH,
        metadata: {
          entityId: flagData.targetId,
          entityType: flagData.targetType,
          actionUrl: `/EyEngage/SupervisorDashboard/social`,
          actorId: flagData.reportedById,
          actorName: flagData.reportedByName,
          department: flagData.department,
        },
      };

      const recipientNames = new Map<string, string>();
      moderatorIds.forEach(id => recipientNames.set(id, 'Modérateur'));
      
      await this.createBulkNotifications(moderatorIds, notification, recipientNames);
    } catch (error) {
      this.logger.error(`💥 Error in notifyContentFlagged: ${error.message}`, error.stack);
    }
  }

  // Méthode utilitaire pour notifier les admins et agents d'un département
  private async notifyAdminsAndAgents(department: string, notificationData: NotificationDataDto) {
    try {
      this.logger.log(`🔍 Finding admins and agents for department: ${department}`);

      // Récupérer tous les admins (tous départements) et agents du département spécifique
      const query = this.userRepository
        .createQueryBuilder('user')
        .where('user.isActive = :isActive', { isActive: true });

      // Construire la condition pour les rôles
      const roleConditions = [
        "user.roles LIKE '%SuperAdmin%'",
        "user.roles LIKE '%Admin%'",
        "(user.roles LIKE '%AgentEY%' AND user.department = :department)"
      ];

      query.andWhere(`(${roleConditions.join(' OR ')})`, { department });

      const adminsAndAgents = await query.getMany();

      if (adminsAndAgents.length === 0) {
        this.logger.warn(`⚠️ No admins or agents found for department ${department}`);
        return;
      }

      this.logger.log(`👥 Found ${adminsAndAgents.length} admins/agents for department ${department}`);

      const recipientIds = adminsAndAgents.map(user => user.id);
      const recipientNames = new Map<string, string>(
        adminsAndAgents.map(user => [user.id, user.fullName])
      );

      await this.createBulkNotifications(recipientIds, notificationData, recipientNames);
      this.logger.log(`✅ Notified ${recipientIds.length} admins/agents for department ${department}`);
    } catch (error) {
      this.logger.error(`💥 Error notifying admins and agents: ${error.message}`, error.stack);
    }
  }

  // Nettoyage automatique des anciennes notifications
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanupOldNotifications() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await this.notificationRepository.delete({
        isRead: true,
        createdAt: LessThan(thirtyDaysAgo),
      });

      this.logger.log(`🧹 Cleaned up ${result.affected} old notifications`);
    } catch (error) {
      this.logger.error(`💥 Error cleaning up notifications: ${error.message}`, error.stack);
    }
  }

  // Helpers privés

  private getDefaultPreferences(): Record<NotificationType, boolean> {
    const preferences: Partial<Record<NotificationType, boolean>> = {};
    
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
      this.logger.error(`💥 Error checking DND schedule: ${error.message}`);
      return false;
    }
  }

  // Méthode de test du système
  async testNotificationSystem(userId: string, userName: string): Promise<boolean> {
    try {
      this.logger.log(`🧪 Testing notification system for user ${userId}`);
      
      // Vérifier le format UUID avant de tester
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      
      if (!uuidRegex.test(userId)) {
        this.logger.warn(`⚠️ Test skipped - Invalid UUID format: ${userId}`);
        return false;
      }

      // Vérifier si l'utilisateur existe avant de créer la notification de test
      const user = await this.userRepository.findOne({
        where: { id: userId }
      });

      if (!user) {
        this.logger.warn(`⚠️ Test user ${userId} not found in database, creating mock test result`);
        return false;
      }

      const testNotification = await this.createNotification({
        recipientId: userId,
        recipientName: userName,
        type: NotificationType.WELCOME,
        title: 'Test de notification',
        message: 'Système de notifications opérationnel ✅',
        priority: NotificationPriority.LOW,
        metadata: {
          entityId: 'test',
          entityType: 'system',
          actionUrl: '/EyEngage/notifications',
        },
      });

      this.logger.log(`✅ Test notification created successfully: ${testNotification.id}`);
      return true;
    } catch (error) {
      this.logger.error(`💥 Test notification failed: ${error.message}`, error.stack);
      return false;
    }
  }

  // Méthodes pour les webhooks depuis .NET
  async handleDotNetWebhook(notificationData: any): Promise<void> {
    try {
      this.logger.log(`🔗 Handling webhook from .NET: ${notificationData.type}`);
      
      await this.createNotification({
        recipientId: notificationData.recipientId,
        recipientName: notificationData.recipientName,
        type: notificationData.type,
        title: notificationData.title,
        message: notificationData.message,
        priority: notificationData.priority || NotificationPriority.MEDIUM,
        metadata: notificationData.metadata,
      });
    } catch (error) {
      this.logger.error(`💥 Error handling .NET webhook: ${error.message}`, error.stack);
      throw error;
    }
  }

  async handleDotNetBulkWebhook(bulkData: any): Promise<void> {
    try {
      this.logger.log(`🔗 Handling bulk webhook from .NET: ${bulkData.recipients?.length} recipients`);
      
      const recipientIds = bulkData.recipients.map((r: any) => r.id);
      const recipientNames = new Map<string, string>(
        bulkData.recipients.map((r: any) => [r.id, r.name])
      );

      await this.createBulkNotifications(
        recipientIds,
        bulkData.notification,
        recipientNames,
      );
    } catch (error) {
      this.logger.error(`💥 Error handling .NET bulk webhook: ${error.message}`, error.stack);
      throw error;
    }
  }
}