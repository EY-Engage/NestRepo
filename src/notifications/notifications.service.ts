// notifications/notifications.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Notification } from './entities/notification.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { KafkaProducerService } from './kafka/producer.service';
import { NotificationsGateway } from './notifications.gateway';
import { HttpService } from '@nestjs/axios';
import { Department } from 'src/shared/enums/department.enum';
import { NotificationType } from 'src/shared/enums/notification-type.enum';
import { Role } from 'src/shared/enums/role.enum';
import { BulkNotificationDto } from './dto/bulk-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private notificationRepository: Repository<Notification>,
    private kafkaProducer: KafkaProducerService,
    private notificationsGateway: NotificationsGateway,
    private configService: ConfigService,
    private httpService: HttpService,
  ) {}

  // Créer une notification simple
  async createNotification(dto: CreateNotificationDto): Promise<Notification> {
    const notification = this.notificationRepository.create({
      ...dto,
      createdAt: new Date(),
    });

    const savedNotification = await this.notificationRepository.save(notification);

    // Diffuser via WebSocket en temps réel
    await this.notificationsGateway.sendNotificationToUser(
      savedNotification.userId,
      savedNotification,
    );

    // Publier dans Kafka pour traitement asynchrone (email, push, etc.)
    await this.kafkaProducer.publishNotification({
      id: savedNotification.id,
      type: savedNotification.type,
      userId: savedNotification.userId,
      title: savedNotification.title,
      content: savedNotification.content,
      data: savedNotification.data,
    });

    return savedNotification;
  }

  // Créer des notifications en masse
  async createBulkNotification(dto: BulkNotificationDto): Promise<Notification[]> {
    // Récupérer les utilisateurs concernés selon les filtres
    let targetUserIds = dto.userIds || [];

    if (dto.departmentFilter || dto.roleFilter) {
      const users = await this.getUsersByFilters(dto.departmentFilter, dto.roleFilter);
      targetUserIds = [...new Set([...targetUserIds, ...users.map(u => u.id)])];
    }

    if (targetUserIds.length === 0) {
      return [];
    }

    // Créer les notifications pour chaque utilisateur
    const notifications = targetUserIds.map(userId => 
      this.notificationRepository.create({
        type: dto.type,
        title: dto.title,
        content: dto.content,
        userId,
        senderId: dto.senderId,
        senderName: dto.senderName,
        data: dto.data,
        actionUrl: dto.actionUrl,
        departmentFilter: dto.departmentFilter,
        roleFilter: dto.roleFilter,
        createdAt: new Date(),
      })
    );

    const savedNotifications = await this.notificationRepository.save(notifications);

    // Diffuser via WebSocket
    for (const notification of savedNotifications) {
      await this.notificationsGateway.sendNotificationToUser(
        notification.userId,
        notification,
      );
    }

    // Publier dans Kafka
    await this.kafkaProducer.publishNotification({
      type: 'BULK_NOTIFICATION',
      notifications: savedNotifications.map(n => ({
        id: n.id,
        type: n.type,
        userId: n.userId,
        title: n.title,
        content: n.content,
      })),
    });

    return savedNotifications;
  }

  // Créer une notification pour tout un département
  async createDepartmentNotification(dto: {
    type: NotificationType;
    title: string;
    content: string;
    departmentFilter: Department;
    senderId?: string;
    senderName?: string;
    targetId?: string;
    targetType?: string;
    actionUrl?: string;
    data?: Record<string, any>;
    excludeUserIds?: string[];
  }): Promise<Notification[]> {
    const users = await this.getUsersByDepartment(dto.departmentFilter);
    let userIds = users.map(u => u.id);

    // Exclure certains utilisateurs si nécessaire
    if (dto.excludeUserIds?.length) {
      userIds = userIds.filter(id => !dto.excludeUserIds.includes(id));
    }

    return this.createBulkNotification({
      userIds,
      type: dto.type,
      title: dto.title,
      content: dto.content,
      senderId: dto.senderId,
      senderName: dto.senderName,
      data: dto.data,
      actionUrl: dto.actionUrl,
      departmentFilter: dto.departmentFilter,
    });
  }

  // Notifier les followers d'un utilisateur (pour le réseau social)
  async notifyFollowers(userId: string, notificationData: {
    type: NotificationType;
    title: string;
    content: string;
    senderId: string;
    senderName: string;
    targetId: string;
    targetType: string;
    actionUrl?: string;
    data?: Record<string, any>;
  }): Promise<Notification[]> {
    // Récupérer les followers depuis le service social
    const followers = await this.getFollowers(userId);
    
    if (followers.length === 0) {
      return [];
    }

    return this.createBulkNotification({
      userIds: followers.map(f => f.followerId),
      ...notificationData,
    });
  }

  // Marquer une notification comme lue
  async markAsRead(notificationId: string, userId: string): Promise<void> {
    await this.notificationRepository.update(
      { id: notificationId, userId },
      { isRead: true, readAt: new Date() }
    );

    // Notifier via WebSocket
    await this.notificationsGateway.sendNotificationUpdate(userId, {
      notificationId,
      isRead: true,
    });
  }

  // Marquer toutes les notifications comme lues
  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationRepository.update(
      { userId, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    // Notifier via WebSocket
    await this.notificationsGateway.sendNotificationUpdate(userId, {
      type: 'ALL_READ',
    });
  }

  // Supprimer une notification
  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    await this.notificationRepository.update(
      { id: notificationId, userId },
      { isDeleted: true }
    );

    await this.notificationsGateway.sendNotificationUpdate(userId, {
      notificationId,
      isDeleted: true,
    });
  }

  // Récupérer les notifications d'un utilisateur
  async getUserNotifications(
    userId: string,
    page: number = 1,
    limit: number = 20,
    unreadOnly: boolean = false,
  ) {
    const queryBuilder = this.notificationRepository
      .createQueryBuilder('notification')
      .where('notification.userId = :userId', { userId })
      .andWhere('notification.isDeleted = false');

    if (unreadOnly) {
      queryBuilder.andWhere('notification.isRead = false');
    }

    const [notifications, total] = await queryBuilder
      .orderBy('notification.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      notifications,
      total,
      unreadCount: await this.getUnreadCount(userId),
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Compter les notifications non lues
  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationRepository.count({
      where: {
        userId,
        isRead: false,
        isDeleted: false,
      },
    });
  }

  // Statistiques pour l'admin
  async getNotificationStats(departmentFilter?: Department) {
    const queryBuilder = this.notificationRepository
      .createQueryBuilder('notification')
      .select([
        'notification.type',
        'COUNT(*) as count',
        'AVG(CASE WHEN notification.isRead THEN 1 ELSE 0 END) as readRate',
      ])
      .groupBy('notification.type');

    if (departmentFilter) {
      queryBuilder.where('notification.departmentFilter = :department', { 
        department: departmentFilter 
      });
    }

    const typeStats = await queryBuilder.getRawMany();

    const totalNotifications = await this.notificationRepository.count(
      departmentFilter ? { where: { departmentFilter } } : {}
    );

    const unreadNotifications = await this.notificationRepository.count({
      where: {
        isRead: false,
        ...(departmentFilter && { departmentFilter }),
      },
    });

    return {
      totalNotifications,
      unreadNotifications,
      readRate: ((totalNotifications - unreadNotifications) / totalNotifications) * 100,
      typeStats,
    };
  }

  // Nettoyer les anciennes notifications
  async cleanupOldNotifications(daysOld: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.notificationRepository.delete({
      createdAt: { $lt: cutoffDate } as any,
      isRead: true,
    });

    return result.affected || 0;
  }

  // Méthodes privées pour récupérer des données utilisateur

  private async getUsersByFilters(
    department?: Department, 
    roles?: Role[]
  ): Promise<{ id: string; department: Department; roles: Role[] }[]> {
    try {
      // Appel à l'API .NET Core pour récupérer les utilisateurs
      const response = await this.httpService.get(
        `${this.configService.get('DOTNET_SERVICE_URL')}/api/users/filtered`,
        {
          params: { department, roles: roles?.join(',') },
          headers: {
            'x-api-key': this.configService.get('DOTNET_SERVICE_API_KEY'),
          },
        }
      ).toPromise();

      return response.data || [];
    } catch (error) {
      console.error('Erreur lors de la récupération des utilisateurs filtrés:', error);
      return [];
    }
  }

  private async getUsersByDepartment(
    department: Department
  ): Promise<{ id: string; department: Department }[]> {
    try {
      const response = await this.httpService.get(
        `${this.configService.get('DOTNET_SERVICE_URL')}/api/users/by-department/${department}`,
        {
          headers: {
            'x-api-key': this.configService.get('DOTNET_SERVICE_API_KEY'),
          },
        }
      ).toPromise();

      return response.data || [];
    } catch (error) {
      console.error('Erreur lors de la récupération des utilisateurs par département:', error);
      return [];
    }
  }

  private async getFollowers(userId: string): Promise<{ followerId: string }[]> {
    try {
      // Cette méthode sera implémentée dans le service social
      // Pour l'instant, retourner un tableau vide
      return [];
    } catch (error) {
      console.error('Erreur lors de la récupération des followers:', error);
      return [];
    }
  }

  // Notifications système spéciales

  async sendSystemAnnouncement(
    title: string,
    content: string,
    targetDepartments?: Department[],
    targetRoles?: Role[],
    priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal'
  ): Promise<Notification[]> {
    const users = await this.getUsersForSystemAnnouncement(targetDepartments, targetRoles);

    return this.createBulkNotification({
      userIds: users.map(u => u.id),
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      title,
      content,
      data: {
        isSystemAnnouncement: true,
        targetDepartments,
        targetRoles,
      },
    });
  }

  private async getUsersForSystemAnnouncement(
    departments?: Department[],
    roles?: Role[]
  ): Promise<{ id: string }[]> {
    try {
      const response = await this.httpService.get(
        `${this.configService.get('DOTNET_SERVICE_URL')}/api/users/for-announcement`,
        {
          params: { 
            departments: departments?.join(','), 
            roles: roles?.join(',') 
          },
          headers: {
            'x-api-key': this.configService.get('DOTNET_SERVICE_API_KEY'),
          },
        }
      ).toPromise();

      return response.data || [];
    } catch (error) {
      console.error('Erreur lors de la récupération des utilisateurs pour annonce:', error);
      return [];
    }
  }

  // Méthodes pour les notifications en temps réel via WebSocket

  async sendRealTimeNotification(userId: string, notification: any) {
    await this.notificationsGateway.sendNotificationToUser(userId, notification);
  }

  async sendRealTimeUpdate(userId: string, update: any) {
    await this.notificationsGateway.sendNotificationUpdate(userId, update);
  }

  // Préférences de notification (à implémenter si nécessaire)
  async updateNotificationPreferences(
    userId: string, 
    preferences: {
      emailNotifications?: boolean;
      pushNotifications?: boolean;
      notificationTypes?: NotificationType[];
    }
  ) {
    // Logique pour sauvegarder les préférences
    // Peut être stocké dans une table séparée ou dans le profil utilisateur
  }
}