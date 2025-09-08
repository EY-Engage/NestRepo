// src/notifications/notifications.controller.ts
import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  ParseIntPipe,
  Headers,
  UnauthorizedException,
  BadRequestException,
  Logger,
  HttpStatus,
  HttpCode,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../shared/decorators/user.decorator';
import { IUser } from '../shared/interfaces/user.interface';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { CreateNotificationDto, CreateBulkNotificationDto } from './dto/create-notification.dto';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  // Endpoint public pour recevoir les notifications depuis .NET
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ 
    transform: true, 
    whitelist: true,
    forbidNonWhitelisted: true
  }))
  @ApiOperation({ summary: 'Webhook pour recevoir les notifications depuis le backend .NET' })
  @ApiResponse({ status: 200, description: 'Notification créée avec succès' })
  @ApiResponse({ status: 400, description: 'Données invalides' })
  @ApiResponse({ status: 401, description: 'API key invalide' })
  async receiveFromDotNet(
    @Body() dto: CreateNotificationDto,
    @Headers('x-api-key') apiKey: string,
  ) {
    this.logger.log(`Received notification webhook: ${JSON.stringify(dto)}`);

    // Vérifier l'API key pour sécuriser la communication
    if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
      this.logger.warn(`Invalid API key attempted: ${apiKey}`);
      throw new UnauthorizedException('Invalid API key');
    }

    try {
      // Validation supplémentaire avant traitement
      if (!dto.recipientId || !dto.recipientName || !dto.type || !dto.title || !dto.message) {
        throw new BadRequestException('Missing required fields');
      }

      await this.notificationsService.createNotification(dto);
      
      this.logger.log(`Notification sent successfully to user ${dto.recipientId}`);
      return { 
        success: true, 
        message: 'Notification créée et envoyée',
        notificationId: dto.recipientId 
      };
    } catch (error) {
      this.logger.error(`Error creating notification: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to create notification: ${error.message}`);
    }
  }

  // Endpoint pour créer plusieurs notifications (bulk)
  @Post('webhook/bulk')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ 
    transform: true, 
    whitelist: true,
    forbidNonWhitelisted: true
  }))
  @ApiOperation({ summary: 'Créer plusieurs notifications en une fois' })
  @ApiResponse({ status: 200, description: 'Notifications créées avec succès' })
  @ApiResponse({ status: 400, description: 'Données invalides' })
  @ApiResponse({ status: 401, description: 'API key invalide' })
  async receiveBulkFromDotNet(
    @Body() dto: CreateBulkNotificationDto,
    @Headers('x-api-key') apiKey: string,
  ) {
    this.logger.log(`Received bulk notification webhook for ${dto.recipients?.length} recipients`);

    if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
      this.logger.warn(`Invalid API key attempted: ${apiKey}`);
      throw new UnauthorizedException('Invalid API key');
    }

    try {
      // Validation supplémentaire
      if (!dto.recipients || dto.recipients.length === 0) {
        throw new BadRequestException('No recipients provided');
      }

      if (!dto.notification || !dto.notification.type || !dto.notification.title || !dto.notification.message) {
        throw new BadRequestException('Invalid notification data');
      }

      const recipientIds = dto.recipients.map(r => r.id);
      const recipientNames = new Map(dto.recipients.map(r => [r.id, r.name]));

      await this.notificationsService.createBulkNotifications(
        recipientIds,
        dto.notification,
        recipientNames,
      );
      
      this.logger.log(`Bulk notifications sent successfully to ${recipientIds.length} users`);
      return { 
        success: true, 
        message: `${recipientIds.length} notifications créées`,
        recipientCount: recipientIds.length
      };
    } catch (error) {
      this.logger.error(`Error creating bulk notifications: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to create bulk notifications: ${error.message}`);
    }
  }

  // Endpoints pour les utilisateurs authentifiés
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Récupérer les notifications de l\'utilisateur connecté' })
  async getUserNotifications(
    @CurrentUser() user: IUser,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
    @Query('isRead') isRead?: string,
    @Query('type') type?: string,
    @Query('priority') priority?: string,
  ) {
    // Limiter la pagination
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));

    return await this.notificationsService.getUserNotifications(
      user.id,
      safePage,
      safeLimit,
      {
        isRead: isRead !== undefined ? isRead === 'true' : undefined,
        type: type as any,
        priority: priority as any,
      },
    );
  }

  @Get('unread')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Récupérer les notifications non lues' })
  async getUnreadNotifications(@CurrentUser() user: IUser) {
    return await this.notificationsService.getUnreadNotifications(user.id);
  }

  @Get('unread/count')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Récupérer le nombre de notifications non lues' })
  async getUnreadCount(@CurrentUser() user: IUser) {
    const count = await this.notificationsService.getUnreadCount(user.id);
    return { count };
  }

  @Put(':id/read')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Marquer une notification comme lue' })
  async markAsRead(
    @Param('id', ParseUUIDPipe) notificationId: string,
    @CurrentUser() user: IUser,
  ) {
    await this.notificationsService.markAsRead(notificationId, user.id);
    return { success: true };
  }

  @Put('read-all')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Marquer toutes les notifications comme lues' })
  async markAllAsRead(@CurrentUser() user: IUser) {
    await this.notificationsService.markAllAsRead(user.id);
    return { success: true };
  }

  @Put(':id/archive')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Archiver une notification' })
  async archiveNotification(
    @Param('id', ParseUUIDPipe) notificationId: string,
    @CurrentUser() user: IUser,
  ) {
    await this.notificationsService.archiveNotification(notificationId, user.id);
    return { success: true };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Supprimer une notification' })
  async deleteNotification(
    @Param('id', ParseUUIDPipe) notificationId: string,
    @CurrentUser() user: IUser,
  ) {
    await this.notificationsService.deleteNotification(notificationId, user.id);
    return { success: true };
  }

  @Get('preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Récupérer les préférences de notification' })
  async getUserPreferences(@CurrentUser() user: IUser) {
    return await this.notificationsService.getUserPreferences(user.id);
  }

  @Put('preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mettre à jour les préférences de notification' })
  async updateUserPreferences(
    @CurrentUser() user: IUser,
    @Body() preferences: any,
  ) {
    return await this.notificationsService.updateUserPreferences(user.id, preferences);
  }
}