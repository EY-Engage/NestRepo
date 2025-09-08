// admin.service.ts - Service principal corrigé
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In, MoreThanOrEqual, LessThanOrEqual, Not } from 'typeorm';
import { Post } from '../social/posts/entities/post.entity';
import { Comment } from '../social/posts/entities/comment.entity';
import { Flag, FlagStatus, FlagAction } from '../social/posts/entities/flag.entity';
import { User } from '../social/posts/entities/user.entity';
import { Department } from '../shared/enums/department.enum';
import { Role } from 'src/shared/enums/role.enum';

import { ContentType } from 'src/shared/enums/content-type.enum';
import { IUser } from 'src/shared/interfaces/user.interface';
import { FlagStatsQueryDto, FlaggedContentQueryDto, UserSearchQueryDto } from './dto/admin.dto';
import { ModerationHistory } from './entities/moderation-history.entity';
import { UserWarning } from './entities/user-warning.entity';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    @InjectRepository(Flag)
    private readonly flagRepository: Repository<Flag>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(ModerationHistory)
    private readonly moderationHistoryRepository: Repository<ModerationHistory>,
    @InjectRepository(UserWarning)
    private readonly userWarningRepository: Repository<UserWarning>,
  ) {}

  // Vérifier les permissions d'administration
  private checkAdminPermissions(user: IUser, targetDepartment?: Department): void {
    if (user.roles.includes(Role.SUPER_ADMIN) || user.roles.includes(Role.ADMIN)) {
      return;
    }
    
    if (user.roles.includes(Role.AGENT_EY)) {
      if (targetDepartment && targetDepartment !== user.department) {
        throw new ForbiddenException('Vous n\'avez pas accès à ce département');
      }
    }
    
    if (!user.roles.includes(Role.SUPER_ADMIN) && 
        !user.roles.includes(Role.ADMIN) && 
        !user.roles.includes(Role.AGENT_EY)) {
      throw new ForbiddenException('Vous n\'avez pas les permissions nécessaires');
    }
  }

  // Obtenir les statistiques du tableau de bord - ENRICHI
  async getDashboardStats(user: IUser, query: FlagStatsQueryDto) {
    const { startDate, endDate, department } = query;
    this.checkAdminPermissions(user, department);

    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter['createdAt'] = Between(new Date(startDate), new Date(endDate));
    } else if (startDate) {
      dateFilter['createdAt'] = MoreThanOrEqual(new Date(startDate));
    } else if (endDate) {
      dateFilter['createdAt'] = LessThanOrEqual(new Date(endDate));
    }

    const departmentFilter = department ? { contentAuthorDepartment: department } : {};
    const whereConditions = { ...dateFilter, ...departmentFilter };

    // Statistiques globales
    const totalFlags = await this.flagRepository.count({ where: whereConditions });
    const pendingFlags = await this.flagRepository.count({ 
      where: { ...whereConditions, status: FlagStatus.PENDING } 
    });
    const underReviewFlags = await this.flagRepository.count({ 
      where: { ...whereConditions, status: FlagStatus.UNDER_REVIEW } 
    });
    const resolvedFlags = await this.flagRepository.count({ 
      where: { 
        ...whereConditions, 
        status: In([FlagStatus.RESOLVED, FlagStatus.DISMISSED]) 
      } 
    });
    const urgentFlags = await this.flagRepository.count({ 
      where: { ...whereConditions, isUrgent: true } 
    });

    // Répartition par type de contenu - ENRICHI
    const flagsByType = await this.flagRepository
      .createQueryBuilder('flag')
      .select([
        'flag.targetType as type',
        'COUNT(flag.id) as count',
        'COUNT(CASE WHEN flag.status = :pending THEN 1 END) as pending',
        'COUNT(CASE WHEN flag.status = :resolved THEN 1 END) as resolved',
        'COUNT(CASE WHEN flag.isUrgent = true THEN 1 END) as urgent'
      ])
      .where(whereConditions)
      .setParameters({
        pending: FlagStatus.PENDING,
        resolved: FlagStatus.RESOLVED
      })
      .groupBy('flag.targetType')
      .getRawMany();

    // Motifs les plus courants - ENRICHI
    const topReasons = await this.flagRepository
      .createQueryBuilder('flag')
      .select([
        'flag.reason as reason',
        'COUNT(flag.id) as count',
        'COUNT(CASE WHEN flag.isUrgent = true THEN 1 END) as urgent_count',
        'AVG(EXTRACT(EPOCH FROM (COALESCE(flag.reviewedAt, NOW()) - flag.createdAt)) / 3600) as avg_resolution_hours'
      ])
      .where(whereConditions)
      .groupBy('flag.reason')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany();

    // Statistiques de résolution - ENRICHI
    const resolutionStats = await this.flagRepository
      .createQueryBuilder('flag')
      .select([
        'flag.actionTaken as action',
        'COUNT(flag.id) as count',
        'AVG(EXTRACT(EPOCH FROM (flag.reviewedAt - flag.createdAt)) / 3600) as avg_hours'
      ])
      .where({ 
        ...whereConditions, 
        status: In([FlagStatus.RESOLVED, FlagStatus.DISMISSED]) 
      })
      .groupBy('flag.actionTaken')
      .getRawMany();

    // Statistiques des modérateurs - ENRICHI avec relations
    const moderatorStats = await this.moderationHistoryRepository
      .createQueryBuilder('history')
      .select([
        'history.moderatorId as moderator_id',
        'history.moderatorName as moderator_name',
        'COUNT(history.id) as total_actions',
        'COUNT(CASE WHEN history.action = :warning THEN 1 END) as warnings',
        'COUNT(CASE WHEN history.action = :hide THEN 1 END) as hidden',
        'COUNT(CASE WHEN history.action = :remove THEN 1 END) as removed',
        'AVG(EXTRACT(EPOCH FROM (history.resolvedAt - history.createdAt)) / 3600) as avg_resolution_hours'
      ])
      .where(dateFilter.hasOwnProperty('createdAt') ? { createdAt: dateFilter['createdAt'] } : {})
      .setParameters({
        warning: FlagAction.WARNING_SENT,
        hide: FlagAction.CONTENT_HIDDEN,
        remove: FlagAction.CONTENT_REMOVED
      })
      .groupBy('history.moderatorId, history.moderatorName')
      .orderBy('total_actions', 'DESC')
      .getRawMany();

    // Tendances récentes - NOUVEAU
    const recentTrends = await this.flagRepository
      .createQueryBuilder('flag')
      .select([
        'DATE(flag.createdAt) as date',
        'COUNT(flag.id) as daily_flags',
        'COUNT(CASE WHEN flag.isUrgent = true THEN 1 END) as urgent_flags'
      ])
      .where('flag.createdAt >= :weekAgo', { weekAgo: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) })
      .groupBy('DATE(flag.createdAt)')
      .orderBy('date', 'DESC')
      .getRawMany();

    const resolutionRate = totalFlags > 0 ? Math.round((resolvedFlags / totalFlags) * 100) : 0;
    const avgResolutionTime = moderatorStats.length > 0 
      ? Math.round(moderatorStats.reduce((acc, stat) => acc + (parseFloat(stat.avg_resolution_hours) || 0), 0) / moderatorStats.length * 100) / 100
      : 0;

    return {
      overview: {
        totalFlags,
        pendingFlags,
        underReviewFlags,
        resolvedFlags,
        urgentFlags,
        resolutionRate,
        avgResolutionTime
      },
      byType: flagsByType.map(item => ({
        type: item.type,
        total: parseInt(item.count),
        pending: parseInt(item.pending),
        resolved: parseInt(item.resolved),
        urgent: parseInt(item.urgent),
        label: item.type === ContentType.POST ? 'Publications' : 'Commentaires'
      })),
      topReasons: topReasons.map(item => ({
        reason: item.reason,
        count: parseInt(item.count),
        urgentCount: parseInt(item.urgent_count),
        avgResolutionHours: Math.round((parseFloat(item.avg_resolution_hours) || 0) * 100) / 100
      })),
      resolutionStats: resolutionStats.map(item => ({
        action: item.action,
        count: parseInt(item.count),
        avgHours: Math.round((parseFloat(item.avg_hours) || 0) * 100) / 100,
        label: this.getActionLabel(item.action)
      })),
      moderatorStats: moderatorStats.map(stat => ({
        moderatorId: stat.moderator_id,
        moderatorName: stat.moderator_name,
        totalActions: parseInt(stat.total_actions),
        warnings: parseInt(stat.warnings),
        hidden: parseInt(stat.hidden),
        removed: parseInt(stat.removed),
        avgResolutionHours: Math.round((parseFloat(stat.avg_resolution_hours) || 0) * 100) / 100
      })),
      recentTrends: recentTrends.map(trend => ({
        date: trend.date,
        dailyFlags: parseInt(trend.daily_flags),
        urgentFlags: parseInt(trend.urgent_flags)
      }))
    };
  }

  // Obtenir les contenus signalés - ENRICHI
  async getFlaggedContent(user: IUser, query: FlaggedContentQueryDto) {
    const { page, limit, status, type, department, urgent } = query;
    this.checkAdminPermissions(user, department);

    const whereConditions: any = {};
    
    if (status) whereConditions.status = status;
    if (type) whereConditions.targetType = type;
    if (department) whereConditions.contentAuthorDepartment = department;
    if (urgent !== undefined) whereConditions.isUrgent = urgent;

    const [flags, total] = await this.flagRepository.findAndCount({
      where: whereConditions,
      order: { 
        isUrgent: 'DESC',
        createdAt: 'DESC',
        reportCount: 'DESC'
      },
      skip: (page - 1) * limit,
      take: limit
    });

    // Enrichir les données avec plus d'informations
    const enrichedFlags = await Promise.all(flags.map(async (flag) => {
      // Récupérer le contenu complet
      let fullContent = null;
      if (flag.targetType === ContentType.POST) {
        fullContent = await this.postRepository.findOne({
          where: { id: flag.targetId }
        });
      } else if (flag.targetType === ContentType.COMMENT) {
        fullContent = await this.commentRepository.findOne({
          where: { id: flag.targetId }
        });
      }

      // Récupérer les signalements similaires
      const relatedFlags = await this.flagRepository.count({
        where: {
          targetId: flag.targetId,
          targetType: flag.targetType,
          id: Not(flag.id)
        }
      });

      return {
        ...flag,
        // Objets virtuels pour la compatibilité
        contentAuthor: {
          id: flag.contentAuthorId,
          fullName: flag.contentAuthorName,
          department: flag.contentAuthorDepartment
        },
        reportedBy: {
          id: flag.reportedById,
          fullName: flag.reportedByName,
          email: flag.reportedByEmail,
          department: flag.reportedByDepartment
        },
        reviewedBy: flag.reviewedById ? {
          id: flag.reviewedById,
          fullName: flag.reviewedByName
        } : null,
        // Informations enrichies
        fullContent: fullContent ? {
          id: fullContent.id,
          content: fullContent.content,
          createdAt: fullContent.createdAt,
          updatedAt: fullContent.updatedAt,
          images: fullContent.images || [],
          files: fullContent.files || [],
          likesCount: fullContent.likesCount || 0,
          commentsCount: fullContent.commentsCount || 0,
          viewsCount: fullContent.viewsCount || 0
        } : null,
        relatedFlagsCount: relatedFlags,
        timeElapsed: this.calculateTimeElapsed(flag.createdAt),
        priorityScore: this.calculatePriorityScore(flag),
        statusLabel: this.getFlagStatusLabel(flag.status),
        actionLabel: flag.actionTaken ? this.getActionLabel(flag.actionTaken) : null
      };
    }));

    return {
      flags: enrichedFlags,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        totalFlags: total,
        urgentFlags: flags.filter(f => f.isUrgent).length,
        pendingFlags: flags.filter(f => f.status === FlagStatus.PENDING).length,
        underReviewFlags: flags.filter(f => f.status === FlagStatus.UNDER_REVIEW).length
      }
    };
  }

  // Nouvelle fonction de modération rapide
  async quickModerationAction(user: IUser, flagId: string, action: 'approve' | 'reject') {
    const flag = await this.flagRepository.findOne({
      where: { id: flagId }
    });

    if (!flag) {
      throw new NotFoundException('Signalement non trouvé');
    }

    this.checkAdminPermissions(user, flag.contentAuthorDepartment as Department);

    let flagAction: FlagAction;
    let newStatus: FlagStatus;
    let contentUpdate: any = {};

    if (action === 'approve') {
      // Signalement fondé - supprimer le contenu
      flagAction = FlagAction.CONTENT_REMOVED;
      newStatus = FlagStatus.RESOLVED;
      contentUpdate = { deletedAt: new Date() };
    } else {
      // Signalement non fondé - rejeter
      flagAction = FlagAction.NO_ACTION;
      newStatus = FlagStatus.DISMISSED;
      contentUpdate = { 
        isFlagged: false, 
        flagReason: null, 
        flaggedById: null, 
        flaggedAt: null 
      };
    }

    // Mettre à jour le contenu
    if (flag.targetType === ContentType.POST) {
      await this.postRepository.update(flag.targetId, contentUpdate);
    } else if (flag.targetType === ContentType.COMMENT) {
      await this.commentRepository.update(flag.targetId, contentUpdate);
    }

    // Mettre à jour le flag
    await this.flagRepository.update(flagId, {
      status: newStatus,
      actionTaken: flagAction,
      reviewedById: user.id,
      reviewedByName: user.fullName,
      reviewedAt: new Date(),
      moderatorNotes: action === 'approve' 
        ? 'Signalement approuvé - Contenu supprimé' 
        : 'Signalement rejeté - Contenu approuvé'
    });

    // Enregistrer dans l'historique
    const moderationHistory = this.moderationHistoryRepository.create({
      targetId: flag.targetId,
      targetType: flag.targetType,
      action: flagAction,
      reason: action === 'approve' 
        ? `Signalement approuvé: ${flag.reason}` 
        : `Signalement rejeté: ${flag.reason}`,
      moderatorId: user.id,
      moderatorName: user.fullName,
      contentAuthorId: flag.contentAuthorId,
      contentAuthorName: flag.contentAuthorName,
      resolvedAt: new Date()
    });

    await this.moderationHistoryRepository.save(moderationHistory);

    return { 
      success: true, 
      message: action === 'approve' 
        ? 'Signalement approuvé et contenu supprimé' 
        : 'Signalement rejeté et contenu approuvé',
      flag: await this.flagRepository.findOne({ where: { id: flagId } })
    };
  }

  // Obtenir les détails d'un signalement - ENRICHI
  async getFlaggedContentDetail(user: IUser, flagId: string) {
    const flag = await this.flagRepository.findOne({
      where: { id: flagId }
    });

    if (!flag) {
      throw new NotFoundException('Signalement non trouvé');
    }

    this.checkAdminPermissions(user, flag.contentAuthorDepartment as Department);

    // Récupérer le contenu signalé avec plus de détails
    let content: any = null;
    if (flag.targetType === ContentType.POST) {
      content = await this.postRepository
        .createQueryBuilder('post')
        .leftJoinAndSelect('post.reactions', 'reactions')
        .leftJoinAndSelect('post.comments', 'comments')
        .where('post.id = :id', { id: flag.targetId })
        .getOne();
    } else if (flag.targetType === ContentType.COMMENT) {
      content = await this.commentRepository
        .createQueryBuilder('comment')
        .leftJoinAndSelect('comment.reactions', 'reactions')
        .where('comment.id = :id', { id: flag.targetId })
        .getOne();
    }

    // Récupérer tous les signalements pour ce contenu
    const allRelatedFlags = await this.flagRepository.find({
      where: { 
        targetId: flag.targetId, 
        targetType: flag.targetType 
      },
      order: { createdAt: 'DESC' }
    });

    // Récupérer l'historique complet de modération
    const moderationHistory = await this.moderationHistoryRepository.find({
      where: { targetId: flag.targetId, targetType: flag.targetType },
      order: { resolvedAt: 'DESC' }
    });

    // Récupérer les informations sur l'auteur du contenu
    const contentAuthor = await this.userRepository.findOne({
      where: { id: flag.contentAuthorId }
    });

    return {
      flag: {
        ...flag,
        contentAuthor: {
          id: flag.contentAuthorId,
          fullName: flag.contentAuthorName,
          department: flag.contentAuthorDepartment,
          email: contentAuthor?.email,
          isActive: contentAuthor?.isActive,
          createdAt: contentAuthor?.createdAt
        },
        reportedBy: {
          id: flag.reportedById,
          fullName: flag.reportedByName,
          email: flag.reportedByEmail,
          department: flag.reportedByDepartment
        },
        reviewedBy: flag.reviewedById ? {
          id: flag.reviewedById,
          fullName: flag.reviewedByName
        } : null,
        statusLabel: this.getFlagStatusLabel(flag.status),
        actionLabel: flag.actionTaken ? this.getActionLabel(flag.actionTaken) : null,
        timeElapsed: this.calculateTimeElapsed(flag.createdAt),
        priorityScore: this.calculatePriorityScore(flag)
      },
      content: content ? {
        ...content,
        reactions: content.reactions || [],
        comments: content.comments || [],
        engagementScore: this.calculateEngagementScore(content)
      } : null,
      allRelatedFlags: allRelatedFlags.map(rf => ({
        ...rf,
        reportedBy: {
          id: rf.reportedById,
          fullName: rf.reportedByName,
          email: rf.reportedByEmail,
          department: rf.reportedByDepartment
        },
        timeElapsed: this.calculateTimeElapsed(rf.createdAt)
      })),
      moderationHistory: moderationHistory.map(mh => ({
        ...mh,
        timeElapsed: this.calculateTimeElapsed(mh.createdAt || mh.resolvedAt),
        actionLabel: this.getActionLabel(mh.action)
      })),
      stats: {
        totalReports: allRelatedFlags.length,
        uniqueReporters: new Set(allRelatedFlags.map(f => f.reportedById)).size,
        avgReportTime: this.calculateAverageReportTime(allRelatedFlags),
        contentAge: this.calculateTimeElapsed(flag.contentCreatedAt)
      }
    };
  }

  // Corriger les statistiques par département - FIX SQL
  async getDepartmentStats(user: IUser, query: FlagStatsQueryDto) {
    this.checkAdminPermissions(user);

    const { startDate, endDate } = query;
    
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter['createdAt'] = Between(new Date(startDate), new Date(endDate));
    }

    // CORRECTION: Utiliser les bons alias avec guillemets pour PostgreSQL
    const stats = await this.flagRepository
      .createQueryBuilder('flag')
      .select([
        'flag.contentAuthorDepartment as department',
        'COUNT(flag.id) as "totalFlags"', // ✅ Guillemets ajoutés
        'SUM(CASE WHEN flag.isUrgent = true THEN 1 ELSE 0 END) as "urgentFlags"',
        'SUM(CASE WHEN flag.status IN (:...resolvedStatuses) THEN 1 ELSE 0 END) as "resolvedFlags"',
        'AVG(EXTRACT(EPOCH FROM (flag.reviewedAt - flag.createdAt)) / 3600) as "avgResolutionTime"'
      ])
      .where(dateFilter)
      .setParameters({ resolvedStatuses: [FlagStatus.RESOLVED, FlagStatus.DISMISSED] })
      .groupBy('flag.contentAuthorDepartment')
      .orderBy('"totalFlags"', 'DESC') // ✅ Guillemets ajoutés
      .getRawMany();

    return stats.map(stat => ({
      department: this.getDepartmentLabel(stat.department),
      departmentKey: stat.department,
      totalFlags: parseInt(stat.totalFlags) || 0,
      urgentFlags: parseInt(stat.urgentFlags) || 0,
      resolvedFlags: parseInt(stat.resolvedFlags) || 0,
      pendingFlags: parseInt(stat.totalFlags) - parseInt(stat.resolvedFlags),
      resolutionRate: stat.totalFlags > 0 
        ? Math.round((parseInt(stat.resolvedFlags) / parseInt(stat.totalFlags)) * 100) 
        : 0,
      avgResolutionTime: Math.round((parseFloat(stat.avgResolutionTime) || 0) * 100) / 100
    }));
  }

  // Corriger les statistiques des modérateurs - FIX SQL
  async getModeratorStats(user: IUser, query: FlagStatsQueryDto) {
    this.checkAdminPermissions(user);

    const { startDate, endDate } = query;
    
    let whereClause = '1=1'; // Condition par défaut
    const parameters: any = {
      warnAction: FlagAction.WARNING_SENT,
      hideAction: FlagAction.CONTENT_HIDDEN,
      deleteAction: FlagAction.CONTENT_REMOVED
    };

    if (startDate && endDate) {
      whereClause = 'history.resolvedAt BETWEEN :startDate AND :endDate';
      parameters.startDate = new Date(startDate);
      parameters.endDate = new Date(endDate);
    } else if (startDate) {
      whereClause = 'history.resolvedAt >= :startDate';
      parameters.startDate = new Date(startDate);
    } else if (endDate) {
      whereClause = 'history.resolvedAt <= :endDate';
      parameters.endDate = new Date(endDate);
    }

    // CORRECTION: Supprimer le paramètre mal formé et utiliser la syntaxe correcte
    const stats = await this.moderationHistoryRepository
      .createQueryBuilder('history')
      .select([
        'history.moderatorId as moderator_id',
        'history.moderatorName as moderator_name',
        'COUNT(history.id) as total_actions',
        'SUM(CASE WHEN history.action = :warnAction THEN 1 ELSE 0 END) as warnings_sent',
        'SUM(CASE WHEN history.action = :hideAction THEN 1 ELSE 0 END) as content_hidden',
        'SUM(CASE WHEN history.action = :deleteAction THEN 1 ELSE 0 END) as content_deleted',
        'AVG(EXTRACT(EPOCH FROM (history.resolvedAt - history.createdAt)) / 3600) as avg_resolution_time'
      ])
      .where(whereClause, parameters) // ✅ Paramètres correctement formatés
      .groupBy('history.moderatorId, history.moderatorName')
      .orderBy('total_actions', 'DESC')
      .getRawMany();

    return stats.map(stat => ({
      moderatorId: stat.moderator_id,
      moderatorName: stat.moderator_name,
      totalActions: parseInt(stat.total_actions) || 0,
      warningsSent: parseInt(stat.warnings_sent) || 0,
      contentHidden: parseInt(stat.content_hidden) || 0,
      contentDeleted: parseInt(stat.content_deleted) || 0,
      avgResolutionTime: Math.round((parseFloat(stat.avg_resolution_time) || 0) * 100) / 100,
      efficiency: this.calculateModeratorEfficiency(stat)
    }));
  }

  // Obtenir l'historique de modération - ENRICHI
  async getModerationHistory(user: IUser, query: any) {
    this.checkAdminPermissions(user);

    const { page, limit, moderatorId, action } = query;
    
    const whereConditions: any = {};
    
    if (moderatorId) whereConditions.moderatorId = moderatorId;
    if (action) whereConditions.action = action;

    const [history, total] = await this.moderationHistoryRepository.findAndCount({
      where: whereConditions,
      order: { resolvedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit
    });

    // Enrichir l'historique avec plus d'informations
    const enrichedHistory = await Promise.all(history.map(async (item) => {
      // Récupérer les détails du signalement original si disponible
      const originalFlag = await this.flagRepository.findOne({
        where: { 
          targetId: item.targetId, 
          targetType: item.targetType 
        },
        order: { createdAt: 'ASC' }
      });

      // Récupérer les informations sur le modérateur
      const moderator = await this.userRepository.findOne({
        where: { id: item.moderatorId }
      });

      return {
        ...item,
        actionLabel: this.getActionLabel(item.action),
        timeElapsed: this.calculateTimeElapsed(item.resolvedAt || item.createdAt),
        originalFlag: originalFlag ? {
          reason: originalFlag.reason,
          description: originalFlag.description,
          reportCount: originalFlag.reportCount,
          isUrgent: originalFlag.isUrgent
        } : null,
        moderator: moderator ? {
          id: moderator.id,
          fullName: moderator.fullName,
          email: moderator.email,
          department: moderator.department,
          profilePicture: moderator.profilePicture
        } : {
          id: item.moderatorId,
          fullName: item.moderatorName,
          email: 'N/A',
          department: 'N/A'
        },
        targetTypeLabel: item.targetType === ContentType.POST ? 'Publication' : 'Commentaire'
      };
    }));

    return {
      history: enrichedHistory,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        totalActions: total,
        uniqueModerators: new Set(history.map(h => h.moderatorId)).size,
        actionTypes: this.groupActionsByType(history)
      }
    };
  }

  // Rechercher des utilisateurs - ENRICHI + CORRECTION DEPARTEMENT
  async searchUsers(user: IUser, query: UserSearchQueryDto) {
    this.checkAdminPermissions(user);

    const { q, department, isActive, hasWarnings, page, limit } = query;
    
    const queryBuilder = this.userRepository.createQueryBuilder('user');
    
    if (q) {
      queryBuilder.where(
        '(LOWER(user.fullName) LIKE LOWER(:query) OR LOWER(user.email) LIKE LOWER(:query))',
        { query: `%${q}%` }
      );
    }
    
    // CORRECTION: Utiliser les bonnes valeurs enum pour Department
    if (department) {
      const validDepartments = Object.values(Department);
      if (validDepartments.includes(department as Department)) {
        queryBuilder.andWhere('user.department = :department', { department });
      }
    }
    
    if (isActive !== undefined) {
      queryBuilder.andWhere('user.isActive = :isActive', { isActive });
    }
    
    // Correction pour hasWarnings - ajouter une relation avec UserWarning
    if (hasWarnings) {
      queryBuilder
        .leftJoin(UserWarning, 'warning', 'warning.userId = user.id AND warning.isActive = true')
        .andWhere('warning.id IS NOT NULL');
    }

    const [users, total] = await queryBuilder
      .orderBy('user.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    // Enrichir les données utilisateur
    const enrichedUsers = await Promise.all(users.map(async (user) => {
      // Compter les avertissements actifs
      const warningCount = await this.userWarningRepository.count({
        where: { userId: user.id, isActive: true }
      });

      // Compter les signalements reçus
      const flagsReceived = await this.flagRepository.count({
        where: { contentAuthorId: user.id }
      });

      // Compter les signalements faits
      const flagsMade = await this.flagRepository.count({
        where: { reportedById: user.id }
      });

      // Récupérer les derniers avertissements
      const recentWarnings = await this.userWarningRepository.find({
        where: { userId: user.id, isActive: true },
        order: { createdAt: 'DESC' },
        take: 3
      });

      return {
        ...user,
        warningCount,
        flagsReceived,
        flagsMade,
        departmentLabel: this.getDepartmentLabel(user.department),
        recentWarnings: recentWarnings.map(w => ({
          id: w.id,
          message: w.message,
          severity: w.severity,
          createdAt: w.createdAt,
          moderatorName: w.moderatorName
        })),
        riskScore: this.calculateUserRiskScore(warningCount, flagsReceived),
        accountAge: this.calculateTimeElapsed(user.createdAt)
      };
    }));

    return {
      users: enrichedUsers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        totalUsers: total,
        activeUsers: enrichedUsers.filter(u => u.isActive).length,
        usersWithWarnings: enrichedUsers.filter(u => u.warningCount > 0).length,
        departmentBreakdown: this.groupUsersByDepartment(enrichedUsers)
      }
    };
  }

  // Fonctions utilitaires privées
  private getFlagStatusLabel(status: FlagStatus): string {
    const labels = {
      [FlagStatus.PENDING]: 'En attente',
      [FlagStatus.UNDER_REVIEW]: 'En cours d\'examen',
      [FlagStatus.RESOLVED]: 'Résolu',
      [FlagStatus.DISMISSED]: 'Rejeté'
    };
    return labels[status] || 'Inconnu';
  }

  private getActionLabel(action: FlagAction): string {
    const labels = {
      [FlagAction.NO_ACTION]: 'Aucune action',
      [FlagAction.WARNING_SENT]: 'Avertissement envoyé',
      [FlagAction.CONTENT_HIDDEN]: 'Contenu masqué',
      [FlagAction.CONTENT_REMOVED]: 'Contenu supprimé',
      [FlagAction.USER_SUSPENDED]: 'Utilisateur suspendu',
      [FlagAction.USER_BANNED]: 'Utilisateur banni'
    };
    return labels[action] || 'Action inconnue';
  }

  private getDepartmentLabel(department: Department): string {
    const labels = {
      [Department.ASSURANCE]: 'Assurance',
      [Department.CONSULTING]: 'Consulting',
      [Department.STRATEGY_AND_TRANSACTIONS]: 'Strategy & Transactions',
      [Department.TAX]: 'Tax'
    };
    return labels[department] || department;
  }

  private calculateTimeElapsed(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} jour${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} heure${hours > 1 ? 's' : ''}`;
    return 'Moins d\'une heure';
  }

  private calculatePriorityScore(flag: Flag): number {
    let score = 0;
    if (flag.isUrgent) score += 50;
    score += flag.reportCount * 10;
    if (flag.status === FlagStatus.PENDING) score += 20;
    return Math.min(score, 100);
  }

  private calculateEngagementScore(content: any): number {
    const reactions = content.reactions?.length || 0;
    const comments = content.commentsCount || 0;
    const views = content.viewsCount || 0;
    return reactions + comments * 2 + Math.floor(views / 10);
  }

  private calculateModeratorEfficiency(stat: any): number {
    const totalActions = parseInt(stat.total_actions) || 0;
    const avgTime = parseFloat(stat.avg_resolution_time) || 0;
    
    if (totalActions === 0 || avgTime === 0) return 0;
    
    // Score basé sur le nombre d'actions et la rapidité
    const actionScore = Math.min(totalActions * 2, 100);
    const speedScore = Math.max(0, 100 - avgTime * 2);
    
    return Math.round((actionScore + speedScore) / 2);
  }

  private calculateUserRiskScore(warnings: number, flagsReceived: number): number {
    let risk = 0;
    risk += warnings * 25; // Chaque avertissement = +25
    risk += flagsReceived * 5; // Chaque signalement reçu = +5
    return Math.min(risk, 100);
  }

  private groupActionsByType(history: ModerationHistory[]): any {
    const groups = {};
    history.forEach(item => {
      const action = item.action;
      groups[action] = (groups[action] || 0) + 1;
    });
    return groups;
  }

  private groupUsersByDepartment(users: any[]): any {
    const groups = {};
    users.forEach(user => {
      const dept = user.department;
      groups[dept] = (groups[dept] || 0) + 1;
    });
    return groups;
  }

  private calculateAverageReportTime(flags: Flag[]): number {
    if (flags.length === 0) return 0;
    
    const times = flags.map(f => {
      const created = new Date(f.createdAt).getTime();
      const reviewed = f.reviewedAt ? new Date(f.reviewedAt).getTime() : Date.now();
      return (reviewed - created) / (1000 * 60 * 60); // en heures
    });
    
    return Math.round(times.reduce((a, b) => a + b, 0) / times.length * 100) / 100;
  }

  // Autres méthodes existantes (updateUserStatus, sendUserWarning, etc.)
  async updateUserStatus(user: IUser, userId: string, isActive: boolean, reason?: string) {
    this.checkAdminPermissions(user);

    const targetUser = await this.userRepository.findOne({ where: { id: userId } });
    
    if (!targetUser) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    await this.userRepository.update(userId, { isActive });

    const history = this.moderationHistoryRepository.create({
      targetId: userId,
      targetType: 'user' as any,
      action: isActive ? FlagAction.NO_ACTION : FlagAction.USER_SUSPENDED,
      reason: reason || (isActive ? 'Compte réactivé' : 'Compte suspendu'),
      moderatorId: user.id,
      moderatorName: user.fullName,
      contentAuthorId: userId,
      contentAuthorName: targetUser.fullName,
      resolvedAt: new Date()
    });

    await this.moderationHistoryRepository.save(history);

    return { 
      success: true, 
      message: `Statut utilisateur ${isActive ? 'activé' : 'désactivé'} avec succès`,
      user: {
        ...targetUser,
        isActive,
        departmentLabel: this.getDepartmentLabel(targetUser.department)
      }
    };
  }

  async sendUserWarning(user: IUser, userId: string, message: string, severity: 'low' | 'medium' | 'high') {
    this.checkAdminPermissions(user);

    const targetUser = await this.userRepository.findOne({ where: { id: userId } });
    
    if (!targetUser) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    const warning = this.userWarningRepository.create({
      userId,
      moderatorId: user.id,
      moderatorName: user.fullName,
      message,
      severity,
      isActive: true
    });

    await this.userWarningRepository.save(warning);

    return { 
      success: true, 
      message: 'Avertissement envoyé avec succès',
      warning: {
        ...warning,
        severityLabel: severity === 'low' ? 'Faible' : severity === 'medium' ? 'Moyen' : 'Élevé'
      }
    };
  }
}