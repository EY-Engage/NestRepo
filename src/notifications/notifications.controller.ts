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
} from '@nestjs/common';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../shared/guards/roles.guard';
import { Roles } from '../shared/decorators/roles.decorator';
import { CurrentUser, CurrentUserId } from '../shared/decorators/user.decorator';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { IUser } from '../shared/interfaces/user.interface';
import { Department } from 'src/shared/enums/department.enum';
import { NotificationType } from 'src/shared/enums/notification-type.enum';
import { Role } from 'src/shared/enums/role.enum';
import { BulkNotificationDto } from './dto/bulk-notification.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // Récupérer les notifications de l'utilisateur connecté
  @Get()
  async getMyNotifications(
    @CurrentUserId() userId: string,
    @Query('page', ParseIntPipe) page: number = 1,
    @Query('limit', ParseIntPipe) limit: number = 20,
    @Query('unreadOnly') unreadOnly: boolean = false,
  ) {
    return this.notificationsService.getUserNotifications(
      userId,
      page,
      limit,
      unreadOnly,
    );
  }

  // Compter les notifications non lues
  @Get('unread-count')
  async getUnreadCount(@CurrentUserId() userId: string) {
    const count = await this.notificationsService.getUnreadCount(userId);
    return { count };
  }

  // Marquer une notification comme lue
  @Put(':id/read')
  async markAsRead(
    @Param('id', ParseUUIDPipe) notificationId: string,
    @CurrentUserId() userId: string,
  ) {
    await this.notificationsService.markAsRead(notificationId, userId);
    return { success: true };
  }

  // Marquer toutes les notifications comme lues
  @Put('mark-all-read')
  async markAllAsRead(@CurrentUserId() userId: string) {
    await this.notificationsService.markAllAsRead(userId);
    return { success: true };
  }

  // Supprimer une notification
  @Delete(':id')
  async deleteNotification(
    @Param('id', ParseUUIDPipe) notificationId: string,
    @CurrentUserId() userId: string,
  ) {
    await this.notificationsService.deleteNotification(notificationId, userId);
    return { success: true };
  }

  // ADMIN ENDPOINTS

  // Créer une notification simple (Admin/AgentEY)
  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.AGENT_EY)
  async createNotification(
    @Body() dto: CreateNotificationDto,
    @CurrentUser() user: IUser,
  ) {
    return this.notificationsService.createNotification(dto);
  }

  // Créer des notifications en masse (Admin/AgentEY)
  @Post('bulk')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.AGENT_EY)
  async createBulkNotification(
    @Body() dto: BulkNotificationDto,
    @CurrentUser() user: IUser,
  ) {
    // Si AgentEY, limiter au département de l'utilisateur
    if (user.roles.includes(Role.AGENT_EY) && !user.roles.includes(Role.ADMIN)) {
      dto.departmentFilter = user.department;
    }

    return this.notificationsService.createBulkNotification(dto);
  }

  // Envoyer une annonce système (Admin seulement)
  @Post('system-announcement')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async sendSystemAnnouncement(
    @Body() dto: {
      title: string;
      content: string;
      targetDepartments?: Department[];
      targetRoles?: Role[];
      priority?: 'low' | 'normal' | 'high' | 'urgent';
    },
    @CurrentUser() user: IUser,
  ) {
    return this.notificationsService.sendSystemAnnouncement(
      dto.title,
      dto.content,
      dto.targetDepartments,
      dto.targetRoles,
      dto.priority || 'normal',
    );
  }

  // Statistiques des notifications (Admin/AgentEY)
  @Get('stats')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.AGENT_EY)
  async getNotificationStats(
    @CurrentUser() user: IUser,
    @Query('department') department?: Department,
  ) {
    // Si AgentEY, filtrer par son département
    const departmentFilter = user.roles.includes(Role.AGENT_EY) && !user.roles.includes(Role.ADMIN)
      ? user.department
      : department;

    return this.notificationsService.getNotificationStats(departmentFilter);
  }

  // Nettoyer les anciennes notifications (Admin seulement)
  @Post('cleanup')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async cleanupOldNotifications(
    @Body() dto: { daysOld?: number },
  ) {
    const deletedCount = await this.notificationsService.cleanupOldNotifications(
      dto.daysOld || 90,
    );
    
    return { 
      success: true, 
      deletedCount,
      message: `${deletedCount} anciennes notifications supprimées`,
    };
  }

  // Récupérer les notifications par type (Admin/AgentEY)
  @Get('by-type/:type')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.AGENT_EY)
  async getNotificationsByType(
    @Param('type') type: NotificationType,
    @CurrentUser() user: IUser,
    @Query('page', ParseIntPipe) page: number = 1,
    @Query('limit', ParseIntPipe) limit: number = 20,
    @Query('department') department?: Department,
  ) {
    // Si AgentEY, filtrer par son département
    const departmentFilter = user.roles.includes(Role.AGENT_EY) && !user.roles.includes(Role.ADMIN)
      ? user.department
      : department;

    // Cette méthode devra être implémentée dans le service
    // return this.notificationsService.getNotificationsByType(type, page, limit, departmentFilter);
    
    return { message: 'Fonctionnalité à implémenter' };
  }

  // Obtenir les préférences de notification de l'utilisateur
  @Get('preferences')
  async getNotificationPreferences(@CurrentUserId() userId: string) {
    // À implémenter selon les besoins
    return { 
      emailNotifications: true,
      pushNotifications: true,
      notificationTypes: Object.values(NotificationType),
    };
  }

  // Mettre à jour les préférences de notification
  @Put('preferences')
  async updateNotificationPreferences(
    @CurrentUserId() userId: string,
    @Body() preferences: {
      emailNotifications?: boolean;
      pushNotifications?: boolean;
      notificationTypes?: NotificationType[];
    },
  ) {
    await this.notificationsService.updateNotificationPreferences(userId, preferences);
    return { success: true };
  }
}