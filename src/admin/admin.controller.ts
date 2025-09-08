
import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { AdminService } from './admin.service';

import { Role } from 'src/shared/enums/role.enum';
import { Roles } from 'src/shared/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/shared/guards/jwt-auth.guard';
import { RolesGuard } from 'src/shared/guards/roles.guard';
import { IUser } from 'src/shared/interfaces/user.interface';
import { FlagStatsQueryDto, UserSearchQueryDto, FlaggedContentQueryDto } from './dto/admin.dto';
import { CurrentUser } from 'src/shared/decorators/user.decorator';
import { Department } from '../shared/enums/department.enum';
import { Flag, FlagStatus } from 'src/social/posts/entities/flag.entity';
import { ContentType } from 'src/shared/enums/content-type.enum';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.AGENT_EY)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ================== DASHBOARD & STATS ==================

  @Get('dashboard/stats')
  async getDashboardStats(@CurrentUser() user: IUser, @Query() query: FlagStatsQueryDto) {
    return this.adminService.getDashboardStats(user, query);
  }

  @Get('dashboard/summary')
  async getDashboardSummary(@CurrentUser() user: IUser) {
    // Résumé rapide pour la page d'accueil
    const stats = await this.adminService.getDashboardStats(user, {});
    return {
      totalPendingFlags: stats.overview.pendingFlags,
      urgentFlags: stats.overview.urgentFlags,
      resolutionRate: stats.overview.resolutionRate,
      topDepartment: stats.byType[0]?.type || 'N/A'
    };
  }

  // ================== FLAGGED CONTENT ==================

  @Get('flagged-content')
  async getFlaggedContent(
    @CurrentUser() user: IUser,
    @Query() query: FlaggedContentQueryDto
  ) {
    return this.adminService.getFlaggedContent(user, query);
  }

  @Get('flagged-content/:id')
  async getFlaggedContentDetail(
    @CurrentUser() user: IUser, 
    @Param('id', ParseUUIDPipe) id: string
  ) {
    return this.adminService.getFlaggedContentDetail(user, id);
  }

  // NOUVELLE ROUTE: Modération rapide
  @Post('flagged-content/:id/quick-action')
  async quickModerationAction(
    @CurrentUser() user: IUser,
    @Param('id', ParseUUIDPipe) flagId: string,
    @Body('action') action: 'approve' | 'reject'
  ) {
    if (!['approve', 'reject'].includes(action)) {
      throw new Error('Action doit être "approve" ou "reject"');
    }
    
    return this.adminService.quickModerationAction(user, flagId, action);
  }

  @Post('flagged-content/:id/assign')
  async assignFlagToModerator(
    @CurrentUser() user: IUser,
    @Param('id', ParseUUIDPipe) flagId: string,
    @Body('moderatorId') moderatorId: string
  ) {
    // Assigner un signalement à un modérateur spécifique
    return { success: true, message: 'Fonctionnalité à implémenter' };
  }

  @Post('flagged-content/bulk-action')
  async bulkModerationAction(
    @CurrentUser() user: IUser,
    @Body('flagIds') flagIds: string[],
    @Body('action') action: string
  ) {
    // Action en lot sur plusieurs signalements
    return { success: true, message: 'Fonctionnalité à implémenter' };
  }

  // ================== MODERATION ACTIONS ==================
/*
  @Post('moderation-action')
  async takeModerationAction(@CurrentUser() user: IUser, @Body() dto: ModerationActionDto) {
    return this.adminService.takeModerationAction(user, dto);
  }*/

  @Get('moderation-history')
  async getModerationHistory(
    @CurrentUser() user: IUser,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('moderatorId') moderatorId?: string,
    @Query('action') action?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    return this.adminService.getModerationHistory(user, { 
      page, 
      limit, 
      moderatorId, 
      action,
      startDate,
      endDate
    });
  }

  @Get('moderation-templates')
  async getModerationTemplates() {
    // Templates de réponses prédéfinies pour la modération
    return {
      templates: [
        {
          id: 'spam',
          name: 'Contenu spam',
          message: 'Ce contenu a été identifié comme spam et supprimé.',
          severity: 'medium',
          action: 'content_removed'
        },
        {
          id: 'harassment',
          name: 'Harcèlement',
          message: 'Ce contenu contient du harcèlement et va à l\'encontre de nos règles communautaires.',
          severity: 'high',
          action: 'content_removed'
        },
        {
          id: 'inappropriate',
          name: 'Contenu inapproprié',
          message: 'Ce contenu ne respecte pas nos standards de contenu professionnel.',
          severity: 'medium',
          action: 'content_hidden'
        },
        {
          id: 'false_positive',
          name: 'Faux positif',
          message: 'Après examen, ce signalement s\'avère non fondé.',
          severity: 'low',
          action: 'no_action'
        }
      ]
    };
  }

  // ================== USER MANAGEMENT ==================

  @Get('users/search')
  async searchUsers(@CurrentUser() user: IUser, @Query() query: UserSearchQueryDto) {
    return this.adminService.searchUsers(user, query);
  }

  @Get('users/:id')
  async getUserDetail(
    @CurrentUser() user: IUser,
    @Param('id', ParseUUIDPipe) userId: string
  ) {
    // Détails complets d'un utilisateur pour la modération
    return { success: true, message: 'Fonctionnalité à implémenter' };
  }

  @Put('users/:id/status')
  async updateUserStatus(
    @CurrentUser() user: IUser,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body('isActive') isActive: boolean,
    @Body('reason') reason?: string
  ) {
    return this.adminService.updateUserStatus(user, userId, isActive, reason);
  }

  @Post('users/:id/warning')
  async sendUserWarning(
    @CurrentUser() user: IUser,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body('message') message: string,
    @Body('severity') severity: 'low' | 'medium' | 'high'
  ) {
    return this.adminService.sendUserWarning(user, userId, message, severity);
  }

  @Get('users/:id/warnings')
  async getUserWarnings(
    @CurrentUser() user: IUser,
    @Param('id', ParseUUIDPipe) userId: string
  ) {
    // Historique des avertissements d'un utilisateur
    return { success: true, data: [], message: 'Fonctionnalité à implémenter' };
  }

  @Get('users/:id/activity')
  async getUserActivity(
    @CurrentUser() user: IUser,
    @Param('id', ParseUUIDPipe) userId: string,
    @Query('days') days: number = 30
  ) {
    // Activité récente d'un utilisateur (posts, comments, signalements)
    return { success: true, data: {}, message: 'Fonctionnalité à implémenter' };
  }

  // ================== CONTENT SEARCH ==================

  /*@Get('content/search')
  async searchContent(@CurrentUser() user: IUser, @Query() query: ContentSearchQueryDto) {
    return this.adminService.searchContent(user, query);
  }
*/
  @Get('content/flagged-trends')
  async getFlaggedContentTrends(@CurrentUser() user: IUser) {
    // Tendances des signalements par période
    return { success: true, data: [], message: 'Fonctionnalité à implémenter' };
  }

  // ================== STATISTICS ==================

  @Get('stats/department')
  async getDepartmentStats(@CurrentUser() user: IUser, @Query() query: FlagStatsQueryDto) {
    return this.adminService.getDepartmentStats(user, query);
  }

  @Get('stats/moderators')
  async getModeratorStats(@CurrentUser() user: IUser, @Query() query: FlagStatsQueryDto) {
    return this.adminService.getModeratorStats(user, query);
  }

  @Get('stats/content-types')
  async getContentTypeStats(@CurrentUser() user: IUser) {
    // Statistiques par type de contenu
    return { success: true, data: [], message: 'Fonctionnalité à implémenter' };
  }

  @Get('stats/resolution-times')
  async getResolutionTimeStats(@CurrentUser() user: IUser) {
    // Statistiques des temps de résolution
    return { success: true, data: [], message: 'Fonctionnalité à implémenter' };
  }

  @Get('stats/export')
  async exportStats(
    @CurrentUser() user: IUser,
    @Query('format') format: 'json' | 'csv' = 'json',
    @Query() query: FlagStatsQueryDto
  ) {
    const stats = await this.adminService.getDashboardStats(user, query);
    
    if (format === 'csv') {
      // Convertir en CSV pour export
      return {
        success: true,
        data: stats,
        downloadUrl: '/api/admin/stats/download/stats.csv'
      };
    }
    
    return {
      success: true,
      data: stats,
      exportedAt: new Date(),
      format
    };
  }

  // ================== SETTINGS & CONFIGURATION ==================

  @Get('settings/moderation-rules')
  async getModerationRules() {
    return {
      autoModerationRules: [
        {
          id: 'auto-hide-3-reports',
          name: 'Masquer automatiquement après 3 signalements',
          enabled: true,
          threshold: 3
        },
        {
          id: 'auto-review-urgent',
          name: 'Marquer urgent après 5 signalements',
          enabled: true,
          threshold: 5
        }
      ]
    };
  }

  @Put('settings/moderation-rules/:id')
  async updateModerationRule(
    @Param('id') ruleId: string,
    @Body('enabled') enabled: boolean
  ) {
    return { success: true, message: 'Règle mise à jour' };
  }

  @Get('moderators')
  async getModerators(@CurrentUser() user: IUser) {
    // Liste des modérateurs disponibles
    return { success: true, data: [], message: 'Fonctionnalité à implémenter' };
  }

  @Get('dashboard/quick-stats')
  async getQuickStats(@CurrentUser() user: IUser) {
    // Stats rapides pour les widgets du dashboard
    const stats = await this.adminService.getDashboardStats(user, {});
    
    return {
      flagsToday: 0, // À calculer
      resolutionRate24h: 0, // À calculer
      avgResponseTime: stats.overview.avgResolutionTime || 0,
      activeIncidents: stats.overview.urgentFlags || 0
    };
  }

  // ================== REPORTING ==================

  @Post('reports/generate')
  async generateReport(
    @CurrentUser() user: IUser,
    @Body('type') reportType: 'monthly' | 'weekly' | 'custom',
    @Body() params: any
  ) {
    return { 
      success: true, 
      reportId: 'report-' + Date.now(),
      status: 'generating',
      message: 'Génération du rapport en cours...' 
    };
  }

  @Get('reports')
  async getReports(@CurrentUser() user: IUser) {
    return { 
      success: true, 
      reports: [],
      message: 'Aucun rapport généré' 
    };
  }

  @Get('reports/:id/download')
  async downloadReport(
    @CurrentUser() user: IUser,
    @Param('id') reportId: string
  ) {
    return { 
      success: true, 
      downloadUrl: `/api/admin/reports/${reportId}/file`,
      message: 'Lien de téléchargement généré' 
    };
  }

  // ================== AUDIT LOG ==================

  @Get('audit-log')
  async getAuditLog(
    @CurrentUser() user: IUser,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 50
  ) {
    return { 
      success: true, 
      logs: [],
      total: 0,
      page,
      limit,
      message: 'Journal d\'audit vide' 
    };
  }
}