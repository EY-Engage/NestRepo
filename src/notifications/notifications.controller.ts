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
import { NotificationsGateway } from './notifications.gateway';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../shared/decorators/user.decorator';
import { IUser } from '../shared/interfaces/user.interface';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { CreateNotificationDto, CreateBulkNotificationDto } from './dto/create-notification.dto';
import { Role } from 'src/shared/enums/role.enum';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  // Endpoint de diagnostic pour vérifier le système
  @Get('health')
  @ApiOperation({ summary: 'Vérifier la santé du système de notifications' })
  async getNotificationHealth() {
    try {
      const diagnostics = await this.notificationsGateway.getDiagnosticInfo();
      const testUserId = '71aac0ac-4c3b-400b-de2e-08ddc9c59836';
      
      // Test de création de notification
      let testResult = false;
      try {
        testResult = await this.notificationsService.testNotificationSystem(testUserId, 'Test User');
      } catch (testError) {
        this.logger.warn(`Test notification failed: ${testError.message}`);
      }

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        diagnostics,
        testResult,
        services: {
          gateway: !!this.notificationsGateway,
          service: !!this.notificationsService,
          connected: diagnostics.service.hasNotificationsService,
        },
      };
    } catch (error) {
      this.logger.error(`Health check failed: ${error.message}`);
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message,
      };
    }
  }

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
    this.logger.log(`🔗 Received notification webhook from .NET:`, {
      type: dto.type,
      recipientId: dto.recipientId,
      title: dto.title,
      priority: dto.priority,
    });

    // Vérifier l'API key
    const expectedApiKey = process.env.INTERNAL_API_KEY || 'ca905aeecc4ed43d605182455d7ecec09b03c64ec5eb1f57963a044a467f452d';
    if (!apiKey || apiKey !== expectedApiKey) {
      this.logger.warn(`🚫 Invalid API key attempted: ${apiKey}`);
      throw new UnauthorizedException('Invalid API key');
    }

    try {
      // Validation supplémentaire
      if (!dto.recipientId || !dto.recipientName || !dto.type || !dto.title || !dto.message) {
        throw new BadRequestException('Missing required fields');
      }

      const notification = await this.notificationsService.createNotification(dto);
      
      this.logger.log(`✅ Notification sent successfully to user ${dto.recipientId}`);
      return { 
        success: true, 
        message: 'Notification créée et envoyée',
        notificationId: notification.id,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`💥 Error creating notification: ${error.message}`, error.stack);
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
  async receiveBulkFromDotNet(
    @Body() dto: CreateBulkNotificationDto,
    @Headers('x-api-key') apiKey: string,
  ) {
    this.logger.log(`🔗 Received bulk notification webhook from .NET for ${dto.recipients?.length} recipients`);

    const expectedApiKey = process.env.INTERNAL_API_KEY || 'ca905aeecc4ed43d605182455d7ecec09b03c64ec5eb1f57963a044a467f452d';
    if (!apiKey || apiKey !== expectedApiKey) {
      this.logger.warn(`🚫 Invalid API key attempted: ${apiKey}`);
      throw new UnauthorizedException('Invalid API key');
    }

    try {
      if (!dto.recipients || dto.recipients.length === 0) {
        throw new BadRequestException('No recipients provided');
      }

      if (!dto.notification || !dto.notification.type || !dto.notification.title || !dto.notification.message) {
        throw new BadRequestException('Invalid notification data');
      }

      const recipientIds = dto.recipients.map(r => r.id);
      const recipientNames = new Map<string, string>(dto.recipients.map(r => [r.id, r.name]));

      await this.notificationsService.createBulkNotifications(
        recipientIds,
        dto.notification,
        recipientNames,
      );
      
      this.logger.log(`✅ Bulk notifications sent successfully to ${recipientIds.length} users`);
      return { 
        success: true, 
        message: `${recipientIds.length} notifications créées`,
        recipientCount: recipientIds.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`💥 Error creating bulk notifications: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to create bulk notifications: ${error.message}`);
    }
  }

  // Test endpoint pour vérifier la communication
  @Post('test')
  @ApiOperation({ summary: 'Tester le système de notifications' })
  async testNotificationSystem(
    @Body() testData: { userId: string; userName: string },
    @Headers('x-api-key') apiKey: string,
  ) {
    const expectedApiKey = process.env.INTERNAL_API_KEY || 'ca905aeecc4ed43d605182455d7ecec09b03c64ec5eb1f57963a044a467f452d';
    if (!apiKey || apiKey !== expectedApiKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    try {
      const result = await this.notificationsService.testNotificationSystem(
        testData.userId, 
        testData.userName
      );
      
      return {
        success: result,
        message: result ? 'Test réussi' : 'Test échoué',
        timestamp: new Date().toISOString(),
        connectionStats: this.notificationsGateway.getConnectionStats(),
      };
    } catch (error) {
      this.logger.error(`Test failed: ${error.message}`);
      return {
        success: false,
        message: `Test échoué: ${error.message}`,
        timestamp: new Date().toISOString(),
      };
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
    @Query('search') search?: string,
  ) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));

    this.logger.log(`📋 Getting notifications for user ${user.id}, page: ${safePage}, limit: ${safeLimit}`);

    const result = await this.notificationsService.getUserNotifications(
      user.id,
      safePage,
      safeLimit,
      {
        isRead: isRead !== undefined ? isRead === 'true' : undefined,
        type: type as any,
        priority: priority as any,
      },
    );

    // Filtrer par recherche si fournie
    if (search && result.notifications) {
      const searchLower = search.toLowerCase();
      result.notifications = result.notifications.filter(n => 
        n.title.toLowerCase().includes(searchLower) ||
        n.message.toLowerCase().includes(searchLower)
      );
    }

    return result;
  }

  @Get('unread')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Récupérer les notifications non lues' })
  async getUnreadNotifications(@CurrentUser() user: IUser) {
    this.logger.log(`📋 Getting unread notifications for user ${user.id}`);
    return await this.notificationsService.getUnreadNotifications(user.id);
  }

  @Get('unread/count')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Récupérer le nombre de notifications non lues' })
  async getUnreadCount(@CurrentUser() user: IUser) {
    const count = await this.notificationsService.getUnreadCount(user.id);
    this.logger.log(`🔢 Unread count for user ${user.id}: ${count}`);
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
    this.logger.log(`✅ Notification ${notificationId} marked as read by user ${user.id}`);
    return { success: true };
  }

  @Put('read-all')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Marquer toutes les notifications comme lues' })
  async markAllAsRead(@CurrentUser() user: IUser) {
    await this.notificationsService.markAllAsRead(user.id);
    this.logger.log(`✅ All notifications marked as read by user ${user.id}`);
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
    this.logger.log(`📁 Notification ${notificationId} archived by user ${user.id}`);
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
    this.logger.log(`🗑️ Notification ${notificationId} deleted by user ${user.id}`);
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

  // Endpoint pour les statistiques (admin seulement)
  @Get('stats')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Statistiques des notifications (admin)' })
  async getNotificationStats(@CurrentUser() user: IUser) {
    // Vérifier les permissions admin
    if (!user.roles.includes(Role.ADMIN) && !user.roles.includes(Role.SUPER_ADMIN)) {
      throw new UnauthorizedException('Permissions insuffisantes');
    }

    const connectionStats = this.notificationsGateway.getConnectionStats();
    const diagnostics = await this.notificationsGateway.getDiagnosticInfo();

    return {
      connections: connectionStats,
      system: diagnostics,
      timestamp: new Date().toISOString(),
    };
  }

  // Endpoint pour forcer la reconnexion d'un utilisateur (admin)
  @Post('force-reconnect/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Forcer la reconnexion d\'un utilisateur (admin)' })
  async forceUserReconnection(
    @Param('userId') userId: string,
    @Body('reason') reason: string,
    @CurrentUser() user: IUser,
  ) {
    if (!user.roles.includes(Role.ADMIN) && !user.roles.includes(Role.SUPER_ADMIN)) {
      throw new UnauthorizedException('Permissions insuffisantes');
    }

    await this.notificationsGateway.forceUserReconnection(userId, reason);
    return { 
      success: true, 
      message: `Reconnexion forcée pour l'utilisateur ${userId}` 
    };
  }

  // Endpoint pour envoyer une notification manuelle (admin)
  @Post('send')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Envoyer une notification manuelle (admin)' })
  async sendManualNotification(
    @Body() dto: CreateNotificationDto,
    @CurrentUser() user: IUser,
  ) {
    if (!user.roles.includes(Role.ADMIN) && !user.roles.includes(Role.SUPER_ADMIN)) {
      throw new UnauthorizedException('Permissions insuffisantes');
    }

    const notification = await this.notificationsService.createNotification(dto);
    return { 
      success: true, 
      notificationId: notification.id,
      message: 'Notification envoyée avec succès' 
    };
  }

  // Endpoint pour broadcast (admin)
  @Post('broadcast')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Diffuser une notification à tous les utilisateurs (admin)' })
  async broadcastNotification(
    @Body() notificationData: any,
    @CurrentUser() user: IUser,
  ) {
    if (!user.roles.includes(Role.SUPER_ADMIN)) {
      throw new UnauthorizedException('Seuls les SuperAdmin peuvent diffuser des notifications');
    }

    await this.notificationsGateway.broadcastNotification(notificationData);
    return { 
      success: true, 
      message: 'Notification diffusée à tous les utilisateurs connectés' 
    };
  }
}