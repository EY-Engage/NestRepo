import { Injectable, NotFoundException, ForbiddenException, BadRequestException, InternalServerErrorException, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder, In } from 'typeorm';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { Reaction } from './entities/reaction.entity';
import { PostView } from './entities/post-view.entity';
import { IUser } from '../../shared/interfaces/user.interface';
import { ContentType } from 'src/shared/enums/content-type.enum';
import { ReactionType } from 'src/shared/enums/reaction-type.enum';
import { Role } from 'src/shared/enums/role.enum';
import { CommentDto } from './dto/comment.dto';
import { CreateCommentDto, UpdateCommentDto } from './dto/create-comment.dto';
import { CreatePostDto, UpdatePostDto, SharePostDto } from './dto/create-post.dto';
import { PostDto } from './dto/post.dto';
import { CreateReactionDto } from './dto/reaction.dto';
import { User } from './entities/user.entity';
import { Bookmark } from './entities/bookmark.entity';
import { Flag, FlagStatus } from './entities/flag.entity';
import { FeedQueryDto, FeedResponseDto } from '../dto/feed.dto';
import { FlagContentDto } from '../dto/moderation.dto';
import { SearchQueryDto, SearchResultDto } from '../dto/search.dto';
import { TrendingDto } from '../dto/trending.dto';
import { NotificationsService } from 'src/notifications/notifications.service';
import { NotificationPriority, NotificationType } from 'src/notifications/entities/notification.entity';

@Injectable()
export class PostsService {
constructor(
  @InjectRepository(Post)
  private readonly postRepository: Repository<Post>,
  @InjectRepository(User)
  private readonly userRepository: Repository<User>,
  @InjectRepository(Comment)
  private commentRepository: Repository<Comment>,
  @InjectRepository(Reaction)
  private reactionRepository: Repository<Reaction>,
  @InjectRepository(Flag)
  private flagRepository: Repository<Flag>,
  @InjectRepository(PostView)
  private postViewRepository: Repository<PostView>,
  @InjectRepository(Bookmark)
  private bookmarkRepository: Repository<Bookmark>,
  @Inject(forwardRef(() => NotificationsService))
  private readonly notificationsService: NotificationsService,
) {}

  // CRÉATION ET GESTION DES POSTS
async createPost(user: IUser, dto: CreatePostDto): Promise<PostDto> {
  console.log('🚀 DEBUG createPost - Début de la fonction');
  console.log('📝 User:', { 
    id: user.id, 
    fullName: user.fullName, 
    isActive: user.isActive,
    department: user.department 
  });
  console.log('📄 DTO:', {
    content: dto.content?.substring(0, 100) + '...',
    mentions: dto.mentions,
    originalPostId: dto.originalPostId,
    isPublic: dto.isPublic
  });

  if (!user.isActive) {
    console.log('❌ User not active, throwing ForbiddenException');
    throw new ForbiddenException('Votre compte doit être activé pour publier');
  }

  const mentions = this.extractMentions(dto.content, dto.mentions || []);
  const tags = this.extractHashtags(dto.content, dto.tags || []);

  console.log('🏷️ Extracted mentions:', mentions);
  console.log('🏷️ Extracted tags:', tags);

  const formattedImages = dto.images ? dto.images.map(img => 
    img.startsWith('http') ? img : `/uploads/${img}`
  ) : [];

  const formattedFiles = dto.files ? dto.files.map(file => 
    file.startsWith('http') ? file : `/uploads/${file}`
  ) : [];

  const post = this.postRepository.create({
    content: dto.content,
    authorId: user.id,
    authorName: user.fullName,
    authorProfilePicture: user.profilePicture, 
    authorDepartment: user.department,
    images: formattedImages,
    files: formattedFiles,
    tags,
    mentions,
    isPublic: dto.isPublic ?? true,
    departmentOnly: dto.departmentOnly ?? false,
    allowComments: dto.allowComments ?? true,
    allowShares: dto.allowShares ?? true,
    originalPostId: dto.originalPostId,
  });

  console.log('📝 Post created (before save):', { 
    id: post.id, 
    authorId: post.authorId,
    originalPostId: post.originalPostId,
    mentions: post.mentions,
    tags: post.tags
  });

  // Gestion du partage
  if (dto.originalPostId) {
    console.log('🔄 Processing post share for originalPostId:', dto.originalPostId);
    
    const originalPost = await this.postRepository.findOne({
      where: { id: dto.originalPostId },
    });

    if (!originalPost) {
      console.log('❌ Original post not found');
      throw new NotFoundException('Post original non trouvé');
    }

    console.log('✅ Original post found:', {
      id: originalPost.id,
      authorId: originalPost.authorId,
      authorName: originalPost.authorName,
      allowShares: originalPost.allowShares
    });

    if (!originalPost.allowShares) {
      console.log('❌ Original post does not allow shares');
      throw new ForbiddenException('Ce post ne peut pas être partagé');
    }

    post.originalAuthorName = originalPost.authorName;
    
    await this.postRepository.increment(
      { id: originalPost.id },
      'sharesCount',
      1
    );

    console.log('📈 Incremented shares count for original post');

    // NOTIFICATION : Post partagé
    console.log('🔔 Starting share notification process...');
    console.log('🔔 NotificationsService available:', !!this.notificationsService);
    
    try {
      await this.notifyPostShared(originalPost, user, dto.content);
      console.log('✅ Share notification sent successfully');
    } catch (error) {
      console.error('❌ Erreur notification partage:', error);
      console.error('❌ Error details:', {
        message: error.message,
        stack: error.stack,
        originalPostAuthorId: originalPost.authorId,
        currentUserId: user.id
      });
    }
  }

  console.log('💾 Saving post to database...');
  const savedPost = await this.postRepository.save(post);
  console.log('✅ Post saved with ID:', savedPost.id);

  // NOTIFICATIONS : Mentions
  if (mentions.length > 0) {
    console.log('🔔 Starting mentions notification process...');
    console.log('🔔 Mentions to process:', mentions);
    console.log('🔔 NotificationsService available:', !!this.notificationsService);
    
    try {
      await this.notifyPostMentions(savedPost, mentions, user);
      console.log('✅ Mentions notifications sent successfully');
    } catch (error) {
      console.error('❌ Erreur notifications mentions:', error);
      console.error('❌ Error details:', {
        message: error.message,
        stack: error.stack,
        mentions: mentions,
        userId: user.id
      });
    }
  } else {
    console.log('ℹ️ No mentions to process');
  }

  console.log('🎯 Mapping post to DTO...');
  const result = await this.mapToDto(savedPost, user);
  console.log('🚀 DEBUG createPost - Fin de la fonction avec succès');
  
  return result;
}


  // GESTION DES COMMENTAIRES
async createComment(user: IUser, dto: CreateCommentDto): Promise<CommentDto> {
  console.log('🚀 DEBUG createComment - Début de la fonction');
  console.log('📝 User:', { 
    id: user.id, 
    fullName: user.fullName, 
    isActive: user.isActive,
    department: user.department 
  });
  console.log('📄 DTO:', {
    postId: dto.postId,
    parentCommentId: dto.parentCommentId,
    content: dto.content?.substring(0, 100) + '...',
    mentions: dto.mentions
  });

  const post = await this.postRepository.findOne({
    where: { id: dto.postId },
  });

  if (!post) {
    console.log('❌ Post not found');
    throw new NotFoundException('Post non trouvé');
  }

  console.log('✅ Post found:', {
    id: post.id,
    authorId: post.authorId,
    authorName: post.authorName,
    allowComments: post.allowComments
  });

  if (!post.allowComments) {
    console.log('❌ Comments disabled for this post');
    throw new ForbiddenException('Les commentaires sont désactivés pour ce post');
  }

  let parentComment = null;
  if (dto.parentCommentId) {
    console.log('🔍 Looking for parent comment:', dto.parentCommentId);
    
    parentComment = await this.commentRepository.findOne({
      where: { id: dto.parentCommentId, postId: dto.postId },
    });

    if (!parentComment) {
      console.log('❌ Parent comment not found');
      throw new NotFoundException('Commentaire parent non trouvé');
    }

    console.log('✅ Parent comment found:', {
      id: parentComment.id,
      authorId: parentComment.authorId,
      authorName: parentComment.authorName
    });
  }

  const mentions = this.extractMentions(dto.content, dto.mentions || []);
  console.log('🏷️ Extracted mentions:', mentions);

  const comment = this.commentRepository.create({
    content: dto.content,
    authorId: user.id,
    authorName: user.fullName,
    authorProfilePicture: user.profilePicture,
    authorDepartment: user.department,
    postId: dto.postId,
    parentCommentId: dto.parentCommentId,
    mentions,
    attachments: dto.attachments,
  });

  console.log('📝 Comment created (before save):', {
    id: comment.id,
    authorId: comment.authorId,
    postId: comment.postId,
    parentCommentId: comment.parentCommentId,
    mentions: comment.mentions
  });

  console.log('💾 Saving comment to database...');
  const savedComment = await this.commentRepository.save(comment);
  console.log('✅ Comment saved with ID:', savedComment.id);

  console.log('📈 Incrementing comments count...');
  await this.postRepository.increment({ id: dto.postId }, 'commentsCount', 1);

  if (parentComment) {
    console.log('📈 Incrementing replies count for parent comment...');
    await this.commentRepository.increment(
      { id: parentComment.id },
      'repliesCount',
      1
    );
  }

  // NOTIFICATIONS SECTION
  console.log('🔔 Starting notification process...');
  console.log('🔔 NotificationsService available:', !!this.notificationsService);

  try {
    // NOTIFICATION : Nouveau commentaire sur le post
    if (post.authorId !== user.id) {
      console.log('🔔 Sending notification to post author...');
      console.log('📝 Post author ID:', post.authorId);
      console.log('📝 Comment author ID:', user.id);
      
      await this.notifyPostComment(post, savedComment, user);
      console.log('✅ Post comment notification sent successfully');
    } else {
      console.log('ℹ️ Skipping post comment notification (self-comment)');
    }

    // NOTIFICATION : Réponse à un commentaire
    if (parentComment && parentComment.authorId !== user.id) {
      console.log('🔔 Sending notification to parent comment author...');
      console.log('📝 Parent comment author ID:', parentComment.authorId);
      console.log('📝 Reply author ID:', user.id);
      
      await this.notifyCommentReply(parentComment, savedComment, user);
      console.log('✅ Comment reply notification sent successfully');
    } else if (parentComment && parentComment.authorId === user.id) {
      console.log('ℹ️ Skipping comment reply notification (self-reply)');
    }

    // NOTIFICATIONS : Mentions dans le commentaire
    if (mentions.length > 0) {
      console.log('🔔 Sending mention notifications...');
      console.log('👥 Mentions to process:', mentions);
      
      await this.notifyCommentMentions(savedComment, mentions, user);
      console.log('✅ Comment mention notifications sent successfully');
    } else {
      console.log('ℹ️ No mentions to process');
    }

  } catch (error) {
    console.error('❌ Erreur notifications commentaire:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      postId: dto.postId,
      userId: user.id
    });
  }

  console.log('🎯 Mapping comment to DTO...');
  const result = await this.mapCommentToDto(savedComment, user);
  console.log('🚀 DEBUG createComment - Fin de la fonction avec succès');

  return result;
}
  // GESTION DES RÉACTIONS
  async toggleReaction(user: IUser, dto: CreateReactionDto): Promise<{ 
    action: 'added' | 'removed' | 'updated'; 
    reaction?: any 
  }> {
    try {
      const target = await this.validateTargetExists(dto.targetId, dto.targetType);

      const existingReaction = await this.reactionRepository.findOne({
        where: {
          userId: user.id,
          targetId: dto.targetId,
          targetType: dto.targetType,
        },
      });

      if (existingReaction) {
        if (existingReaction.type === dto.type) {
          await this.reactionRepository.remove(existingReaction);
          await this.decrementReactionCount(dto.targetId, dto.targetType);
          return { action: 'removed' };
        } else {
          existingReaction.type = dto.type;
          const updatedReaction = await this.reactionRepository.save(existingReaction);
          return { action: 'updated', reaction: updatedReaction };
        }
      } else {
        const reaction = this.reactionRepository.create({
          type: dto.type,
          userId: user.id,
          userName: user.fullName,
          userProfilePicture: user.profilePicture,
          userDepartment: user.department,
          targetId: dto.targetId,
          targetType: dto.targetType,
          createdAt: new Date(),
        });

        const savedReaction = await this.reactionRepository.save(reaction);
        await this.incrementReactionCount(dto.targetId, dto.targetType);

        // NOTIFICATION : Réaction sur post/commentaire
        try {
          if (dto.targetType === ContentType.POST) {
            const post = target as Post;
            if (post.authorId !== user.id) {
              await this.notifyPostReaction(post, savedReaction, user);
            }
          } else if (dto.targetType === ContentType.COMMENT) {
            const comment = target as Comment;
            if (comment.authorId !== user.id) {
              await this.notifyCommentReaction(comment, savedReaction, user);
            }
          }
        } catch (error) {
          console.error('Erreur notification réaction:', error);
        }

        return { action: 'added', reaction: savedReaction };
      }
    } catch (error) {
      console.error('Error in toggleReaction:', error);
      
      if (error instanceof NotFoundException || 
          error instanceof BadRequestException ||
          error instanceof ForbiddenException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Failed to toggle reaction');
    }
  }

  // SIGNALEMENT AVEC GESTION COMPLÈTE
  async flagContent(user: IUser, dto: FlagContentDto): Promise<{ success: boolean; message: string; flagId?: string }> {
    if (!dto.targetId || !dto.targetType || !dto.reason) {
      throw new BadRequestException('Informations de signalement incomplètes');
    }

    let targetContent: any;
    let contentAuthor: { id: string; name: string; department: string };
    
    try {
      if (dto.targetType === ContentType.POST) {
        targetContent = await this.postRepository.findOne({
          where: { id: dto.targetId, deletedAt: null },
        });
        
        if (!targetContent) {
          throw new NotFoundException('Publication non trouvée');
        }
        
        contentAuthor = {
          id: targetContent.authorId,
          name: targetContent.authorName,
          department: targetContent.authorDepartment
        };
        
      } else if (dto.targetType === ContentType.COMMENT) {
        targetContent = await this.commentRepository.findOne({
          where: { id: dto.targetId, deletedAt: null },
        });
        
        if (!targetContent) {
          throw new NotFoundException('Commentaire non trouvé');
        }
        
        contentAuthor = {
          id: targetContent.authorId,
          name: targetContent.authorName,
          department: targetContent.authorDepartment
        };
      } else {
        throw new BadRequestException('Type de contenu non supporté');
      }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      console.error('Erreur lors de la vérification du contenu:', error);
      throw new InternalServerErrorException('Erreur lors de la vérification du contenu');
    }

    const existingFlag = await this.flagRepository.findOne({
      where: {
        targetId: dto.targetId,
        targetType: dto.targetType,
        reportedById: user.id,
      },
    });

    if (existingFlag) {
      if (existingFlag.status === FlagStatus.PENDING) {
        return { 
          success: false, 
          message: 'Vous avez déjà signalé ce contenu. Il est en cours d\'examen.' 
        };
      }
    }

    if (contentAuthor.id === user.id) {
      throw new ForbiddenException('Vous ne pouvez pas signaler votre propre contenu');
    }

    const relatedFlags = await this.flagRepository.find({
      where: {
        targetId: dto.targetId,
        targetType: dto.targetType,
        status: In([FlagStatus.PENDING, FlagStatus.UNDER_REVIEW]),
      },
      order: { createdAt: 'DESC' }
    });

    const reportCount = relatedFlags.length + 1;
    const isUrgent = reportCount >= 3;

    let contentSnippet = '';
    if (dto.targetType === ContentType.POST) {
      contentSnippet = targetContent.content?.substring(0, 500) || '[Contenu sans texte]';
    } else if (dto.targetType === ContentType.COMMENT) {
      contentSnippet = targetContent.content?.substring(0, 300) || '[Commentaire vide]';
    }

    const flagData = {
      targetId: dto.targetId,
      targetType: dto.targetType,
      reason: dto.reason,
      description: dto.description,
      reportedById: user.id,
      reportedByName: user.fullName,
      reportedByEmail: user.email,
      reportedByDepartment: user.department,
      contentAuthorId: contentAuthor.id,
      contentAuthorName: contentAuthor.name,
      contentAuthorDepartment: contentAuthor.department,
      contentSnippet,
      contentCreatedAt: targetContent.createdAt,
      isUrgent,
      reportCount,
      status: FlagStatus.PENDING,
      relatedFlagIds: JSON.stringify(relatedFlags.map(f => f.id)),
    };

    const flag = this.flagRepository.create(flagData);

    try {
      const savedFlag = await this.flagRepository.save(flag);

      // NOTIFICATION : Contenu signalé aux modérateurs
      if (isUrgent) {
        const users = await this.userRepository.find({
          where: { department: user.department },
        });

        // CORRECTION CRITIQUE : Filtrer avec u.roles au lieu de user.roles
        const moderators = users.filter(u => {
          // Vérifier que u.roles existe et contient les rôles requis
          return u.roles && (
            u.roles.includes(Role.ADMIN) || 
            u.roles.includes(Role.AGENT_EY) 
          );
        });

        if (moderators.length > 0) {
          const moderatorIds = moderators.map(m => m.id);
          const moderatorNames = new Map(moderators.map(m => [m.id, m.fullName]));

          await this.notificationsService.createBulkNotifications(
            moderatorIds,
            {
              type: NotificationType.CONTENT_FLAGGED,
              title: 'Contenu signalé urgent',
              message: `Un contenu a été signalé ${reportCount} fois: ${dto.reason}`,
              priority: NotificationPriority.URGENT,
              metadata: {
                entityId: dto.targetId,
                entityType: dto.targetType,
                actionUrl: `/admin/flagged-content/${savedFlag.id}`,
                actorId: user.id,
                actorName: user.fullName,
                actorAvatar: user.profilePicture,
              },
            },
            moderatorNames,
          );
        }
      }

      if (reportCount === 1) {
        if (dto.targetType === ContentType.POST) {
          await this.postRepository.update(dto.targetId, {
            isFlagged: true,
            flagReason: dto.reason,
            flaggedById: user.id,
            flaggedAt: new Date(),
          });
        } else if (dto.targetType === ContentType.COMMENT) {
          await this.commentRepository.update(dto.targetId, {
            isFlagged: true,
            flagReason: dto.reason,
            flaggedById: user.id,
            flaggedAt: new Date(),
          });
        }
      }

      return { 
        success: true, 
        message: reportCount === 1 
          ? 'Contenu signalé avec succès. Notre équipe va examiner votre signalement.'
          : `Contenu signalé avec succès. Ce contenu a maintenant ${reportCount} signalement${reportCount > 1 ? 's' : ''} et va être examiné en priorité.`,
        flagId: savedFlag.id,
      };

    } catch (error) {
      console.error('Erreur lors de la création du signalement:', error);
      throw new InternalServerErrorException('Erreur lors de l\'enregistrement du signalement');
    }
  }

  // ==================== MÉTHODES DE NOTIFICATION COMPLÈTES ====================

  // Notification pour mention dans un post
 private async notifyPostMentions(post: Post, mentions: string[], actor: IUser): Promise<void> {
  console.log('🔔 notifyPostMentions - Début');
  console.log('📝 Post ID:', post.id);
  console.log('👥 Mentions:', mentions);
  console.log('🎭 Actor:', { id: actor.id, fullName: actor.fullName });

  for (const mention of mentions) {
    console.log(`🔍 Processing mention: "${mention}"`);
    
    try {
      const mentionedUser = await this.userRepository.findOne({
        where: { fullName: mention }
      });

      console.log('🔍 User search result for mention:', {
        mention: mention,
        found: !!mentionedUser,
        userId: mentionedUser?.id,
        userFullName: mentionedUser?.fullName
      });

      if (mentionedUser && mentionedUser.id !== actor.id) {
        console.log('✅ Valid mention, creating notification...');
        console.log('🔔 NotificationsService:', {
          available: !!this.notificationsService,
          type: typeof this.notificationsService,
          hasCreateMethod: this.notificationsService && typeof this.notificationsService.createNotification === 'function'
        });

        const notificationData = {
          recipientId: mentionedUser.id,
          recipientName: mentionedUser.fullName,
          type: NotificationType.POST_MENTION,
          title: 'Vous avez été mentionné',
          message: `${actor.fullName} vous a mentionné dans une publication`,
          priority: NotificationPriority.MEDIUM,
          metadata: {
            entityId: post.id,
            entityType: 'post',
            actionUrl: `/social/posts/${post.id}`,
            actorId: actor.id,
            actorName: actor.fullName,
            actorAvatar: actor.profilePicture,
          },
        };

        console.log('📋 Notification data:', notificationData);

        const notification = await this.notificationsService.createNotification(notificationData);
        
        console.log('✅ Notification created successfully:', {
          id: notification.id,
          recipientId: notification.recipientId,
          type: notification.type
        });
      } else if (!mentionedUser) {
        console.log(`⚠️ User not found for mention: "${mention}"`);
      } else if (mentionedUser.id === actor.id) {
        console.log(`ℹ️ Skipping self-mention for: "${mention}"`);
      }
    } catch (error) {
      console.error(`❌ Erreur notification mention "${mention}":`, error);
      console.error('❌ Error details:', {
        message: error.message,
        stack: error.stack,
        mention: mention,
        actorId: actor.id
      });
    }
  }
  
  console.log('🔔 notifyPostMentions - Fin');
}

private async notifyCommentMentions(comment: Comment, mentions: string[], actor: IUser): Promise<void> {
  console.log('🔔 notifyCommentMentions - Début');
  console.log('📝 Comment:', {
    id: comment.id,
    postId: comment.postId,
    authorId: comment.authorId,
    content: comment.content?.substring(0, 50) + '...'
  });
  console.log('👥 Mentions:', mentions);
  console.log('🎭 Actor:', { id: actor.id, fullName: actor.fullName });

  for (const mention of mentions) {
    console.log(`🔍 Processing comment mention: "${mention}"`);
    
    try {
      // Recherche améliorée avec plusieurs stratégies
      let mentionedUser = null;

      // 1. Recherche exacte
      mentionedUser = await this.userRepository.findOne({
        where: { fullName: mention }
      });

      // 2. Si pas trouvé, recherche case-insensitive
      if (!mentionedUser) {
        mentionedUser = await this.userRepository
          .createQueryBuilder('user')
          .where('LOWER(user.fullName) = LOWER(:name)', { name: mention })
          .getOne();
      }

      // 3. Si pas trouvé, recherche par email
      if (!mentionedUser) {
        mentionedUser = await this.userRepository.findOne({
          where: { email: mention }
        });
      }

      console.log('🔍 User search result for comment mention:', {
        mention: mention,
        found: !!mentionedUser,
        userId: mentionedUser?.id,
        userFullName: mentionedUser?.fullName,
        userEmail: mentionedUser?.email
      });

      if (mentionedUser && mentionedUser.id !== actor.id) {
        console.log('✅ Valid comment mention, creating notification...');
        console.log('🔔 NotificationsService:', {
          available: !!this.notificationsService,
          type: typeof this.notificationsService,
          hasCreateMethod: this.notificationsService && typeof this.notificationsService.createNotification === 'function'
        });

        const notificationData = {
          recipientId: mentionedUser.id,
          recipientName: mentionedUser.fullName,
          type: NotificationType.POST_MENTION,
          title: 'Vous avez été mentionné',
          message: `${actor.fullName} vous a mentionné dans un commentaire`,
          priority: NotificationPriority.MEDIUM,
          metadata: {
            entityId: comment.postId,
            entityType: 'comment',
            actionUrl: `/social/posts/${comment.postId}#comment-${comment.id}`,
            actorId: actor.id,
            actorName: actor.fullName,
            actorAvatar: actor.profilePicture,
          },
        };

        console.log('📋 Comment mention notification data:', notificationData);

        const notification = await this.notificationsService.createNotification(notificationData);
        
        console.log('✅ Comment mention notification created successfully:', {
          id: notification.id,
          recipientId: notification.recipientId,
          type: notification.type
        });
      } else if (!mentionedUser) {
        console.log(`❌ User not found for comment mention: "${mention}"`);
      } else if (mentionedUser.id === actor.id) {
        console.log(`ℹ️ Skipping self-mention in comment for: "${mention}"`);
      }
    } catch (error) {
      console.error(`❌ Erreur notification mention commentaire "${mention}":`, error);
      console.error('❌ Error details:', {
        message: error.message,
        stack: error.stack,
        mention: mention,
        actorId: actor.id,
        commentId: comment.id
      });
    }
  }
  
  console.log('🔔 notifyCommentMentions - Fin');
}
private async notifyPostComment(post: Post, comment: Comment, actor: IUser): Promise<void> {
  console.log('🔔 notifyPostComment - Début');
  console.log('📝 Post:', {
    id: post.id,
    authorId: post.authorId,
    authorName: post.authorName
  });
  console.log('📝 Comment:', {
    id: comment.id,
    authorId: comment.authorId,
    content: comment.content?.substring(0, 50) + '...'
  });
  console.log('🎭 Actor:', { id: actor.id, fullName: actor.fullName });

  try {
    console.log('🔍 Looking for post author in database...');
    const postAuthor = await this.userRepository.findOne({
      where: { id: post.authorId }
    });

    console.log('🔍 Post author search result:', {
      found: !!postAuthor,
      userId: postAuthor?.id,
      userFullName: postAuthor?.fullName,
      userEmail: postAuthor?.email,
      isActive: postAuthor?.isActive
    });

    if (postAuthor && postAuthor.id !== actor.id) {
      console.log('✅ Valid comment notification target, creating notification...');
      console.log('🔔 NotificationsService:', {
        available: !!this.notificationsService,
        type: typeof this.notificationsService,
        hasCreateMethod: this.notificationsService && typeof this.notificationsService.createNotification === 'function'
      });

      const notificationData = {
        recipientId: postAuthor.id,
        recipientName: postAuthor.fullName,
        type: NotificationType.POST_COMMENT,
        title: 'Nouveau commentaire',
        message: `${actor.fullName} a commenté votre publication`,
        priority: NotificationPriority.MEDIUM,
        metadata: {
          entityId: post.id,
          entityType: 'post',
          actionUrl: `/social/posts/${post.id}#comment-${comment.id}`,
          actorId: actor.id,
          actorName: actor.fullName,
          actorAvatar: actor.profilePicture,
        },
      };

      console.log('📋 Post comment notification data:', notificationData);

      const notification = await this.notificationsService.createNotification(notificationData);
      
      console.log('✅ Post comment notification created successfully:', {
        id: notification.id,
        recipientId: notification.recipientId,
        type: notification.type
      });
    } else if (!postAuthor) {
      console.log('⚠️ Post author not found in database');
    } else if (postAuthor.id === actor.id) {
      console.log('ℹ️ Skipping self-comment notification');
    }
  } catch (error) {
    console.error('❌ Erreur notification commentaire post:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      postId: post.id,
      actorId: actor.id
    });
  }

  console.log('🔔 notifyPostComment - Fin');
}
private async notifyCommentReply(parentComment: Comment, reply: Comment, actor: IUser): Promise<void> {
  console.log('🔔 notifyCommentReply - Début');
  console.log('📝 Parent comment:', {
    id: parentComment.id,
    authorId: parentComment.authorId,
    authorName: parentComment.authorName,
    content: parentComment.content?.substring(0, 50) + '...'
  });
  console.log('📝 Reply:', {
    id: reply.id,
    authorId: reply.authorId,
    content: reply.content?.substring(0, 50) + '...'
  });
  console.log('🎭 Actor:', { id: actor.id, fullName: actor.fullName });

  try {
    console.log('🔍 Looking for parent comment author in database...');
    const parentAuthor = await this.userRepository.findOne({
      where: { id: parentComment.authorId }
    });

    console.log('🔍 Parent author search result:', {
      found: !!parentAuthor,
      userId: parentAuthor?.id,
      userFullName: parentAuthor?.fullName,
      userEmail: parentAuthor?.email,
      isActive: parentAuthor?.isActive
    });

    if (parentAuthor) {
      console.log('✅ Valid reply notification target, creating notification...');
      console.log('🔔 NotificationsService:', {
        available: !!this.notificationsService,
        type: typeof this.notificationsService,
        hasCreateMethod: this.notificationsService && typeof this.notificationsService.createNotification === 'function'
      });

      const notificationData = {
        recipientId: parentAuthor.id,
        recipientName: parentAuthor.fullName,
        type: NotificationType.POST_COMMENT,
        title: 'Réponse à votre commentaire',
        message: `${actor.fullName} a répondu à votre commentaire`,
        priority: NotificationPriority.MEDIUM,
        metadata: {
          entityId: reply.postId,
          entityType: 'comment',
          actionUrl: `/social/posts/${reply.postId}#comment-${reply.id}`,
          actorId: actor.id,
          actorName: actor.fullName,
          actorAvatar: actor.profilePicture,
        },
      };

      console.log('📋 Comment reply notification data:', notificationData);

      const notification = await this.notificationsService.createNotification(notificationData);
      
      console.log('✅ Comment reply notification created successfully:', {
        id: notification.id,
        recipientId: notification.recipientId,
        type: notification.type
      });
    } else {
      console.log('⚠️ Parent comment author not found in database');
    }
  } catch (error) {
    console.error('❌ Erreur notification réponse commentaire:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      parentCommentId: parentComment.id,
      actorId: actor.id
    });
  }

  console.log('🔔 notifyCommentReply - Fin');
}

  // Notification pour réaction sur un post
  private async notifyPostReaction(post: Post, reaction: any, actor: IUser): Promise<void> {
    try {
      const postAuthor = await this.userRepository.findOne({
        where: { id: post.authorId }
      });

      if (postAuthor) {
        await this.notificationsService.createNotification({
          recipientId: postAuthor.id,
          recipientName: postAuthor.fullName,
          type: NotificationType.POST_REACTION,
          title: 'Réaction sur votre publication',
          message: `${actor.fullName} a réagi à votre publication`,
          priority: NotificationPriority.LOW,
          metadata: {
            entityId: post.id,
            entityType: 'post',
            actionUrl: `/social/posts/${post.id}`,
            actorId: actor.id,
            actorName: actor.fullName,
            actorAvatar: actor.profilePicture,
            additionalData: { reactionType: reaction.type }
          },
        });
      }
    } catch (error) {
      console.error('Erreur notification réaction post:', error);
    }
  }

  // Notification pour réaction sur un commentaire
  private async notifyCommentReaction(comment: Comment, reaction: any, actor: IUser): Promise<void> {
    try {
      const commentAuthor = await this.userRepository.findOne({
        where: { id: comment.authorId }
      });

      if (commentAuthor) {
        await this.notificationsService.createNotification({
          recipientId: commentAuthor.id,
          recipientName: commentAuthor.fullName,
          type: NotificationType.POST_REACTION,
          title: 'Réaction sur votre commentaire',
          message: `${actor.fullName} a réagi à votre commentaire`,
          priority: NotificationPriority.LOW,
          metadata: {
            entityId: comment.postId,
            entityType: 'comment',
            actionUrl: `/social/posts/${comment.postId}#comment-${comment.id}`,
            actorId: actor.id,
            actorName: actor.fullName,
            actorAvatar: actor.profilePicture,
            additionalData: { reactionType: reaction.type }
          },
        });
      }
    } catch (error) {
      console.error('Erreur notification réaction commentaire:', error);
    }
  }

  // Notification pour partage de post
private async notifyPostShared(originalPost: Post, actor: IUser, comment?: string): Promise<void> {
  console.log('🔔 notifyPostShared - Début');
  console.log('📝 Original post:', {
    id: originalPost.id,
    authorId: originalPost.authorId,
    authorName: originalPost.authorName
  });
  console.log('🎭 Actor:', { id: actor.id, fullName: actor.fullName });
  console.log('💬 Comment:', comment);

  try {
    const originalAuthor = await this.userRepository.findOne({
      where: { id: originalPost.authorId }
    });

    console.log('🔍 Original author search result:', {
      found: !!originalAuthor,
      userId: originalAuthor?.id,
      userFullName: originalAuthor?.fullName
    });

    if (originalAuthor && originalAuthor.id !== actor.id) {
      console.log('✅ Valid share notification target, creating notification...');
      console.log('🔔 NotificationsService:', {
        available: !!this.notificationsService,
        type: typeof this.notificationsService,
        hasCreateMethod: this.notificationsService && typeof this.notificationsService.createNotification === 'function'
      });

      const notificationData = {
        recipientId: originalAuthor.id,
        recipientName: originalAuthor.fullName,
        type: NotificationType.POST_SHARE,
        title: 'Votre publication a été partagée',
        message: comment 
          ? `${actor.fullName} a partagé votre publication avec un commentaire`
          : `${actor.fullName} a partagé votre publication`,
        priority: NotificationPriority.MEDIUM,
        metadata: {
          entityId: originalPost.id,
          entityType: 'post',
          actionUrl: `/social/posts/${originalPost.id}`,
          actorId: actor.id,
          actorName: actor.fullName,
          actorAvatar: actor.profilePicture,
          additionalData: { shareComment: comment }
        },
      };

      console.log('📋 Share notification data:', notificationData);

      const notification = await this.notificationsService.createNotification(notificationData);
      
      console.log('✅ Share notification created successfully:', {
        id: notification.id,
        recipientId: notification.recipientId,
        type: notification.type
      });
    } else if (!originalAuthor) {
      console.log('⚠️ Original author not found');
    } else if (originalAuthor.id === actor.id) {
      console.log('ℹ️ Skipping self-share notification');
    }
  } catch (error) {
    console.error('❌ Erreur notification partage:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      originalPostId: originalPost.id,
      actorId: actor.id
    });
  }

  console.log('🔔 notifyPostShared - Fin');
}
  // ==================== AUTRES MÉTHODES (INCHANGÉES) ====================

  async updatePost(postId: string, user: IUser, dto: UpdatePostDto): Promise<PostDto> {
    const post = await this.postRepository.findOne({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post non trouvé');
    }

    if (post.authorId !== user.id && !this.canModerateContent(user)) {
      throw new ForbiddenException('Vous ne pouvez modifier que vos propres posts');
    }

    if (dto.content !== undefined) {
      post.content = dto.content;
      post.tags = this.extractHashtags(dto.content, dto.tags || []);
      post.isEdited = true;
    }

    if (dto.isPublic !== undefined) post.isPublic = dto.isPublic;
    if (dto.departmentOnly !== undefined) post.departmentOnly = dto.departmentOnly;
    if (dto.allowComments !== undefined) post.allowComments = dto.allowComments;
    if (dto.allowShares !== undefined) post.allowShares = dto.allowShares;

    const updatedPost = await this.postRepository.save(post);
    return this.mapToDto(updatedPost, user);
  }

  async deletePost(postId: string, user: IUser): Promise<void> {
    const post = await this.postRepository.findOne({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post non trouvé');
    }

    if (post.authorId !== user.id && !this.canModerateContent(user)) {
      throw new ForbiddenException('Vous ne pouvez supprimer que vos propres posts');
    }

    post.deletedAt = new Date();
    await this.postRepository.save(post);
  }

  async sharePost(user: IUser, dto: SharePostDto): Promise<PostDto> {
    return this.createPost(user, {
      content: dto.comment || '',
      originalPostId: dto.originalPostId,
      isPublic: dto.isPublic,
      departmentOnly: dto.departmentOnly,
    });
  }

  async updateComment(commentId: string, user: IUser, dto: UpdateCommentDto): Promise<CommentDto> {
    const comment = await this.commentRepository.findOne({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException('Commentaire non trouvé');
    }

    if (comment.authorId !== user.id && !this.canModerateContent(user)) {
      throw new ForbiddenException('Vous ne pouvez modifier que vos propres commentaires');
    }

    if (dto.content !== undefined) {
      comment.content = dto.content;
      comment.mentions = this.extractMentions(dto.content, dto.mentions || []);
      comment.isEdited = true;
    }

    if (dto.attachments !== undefined) comment.attachments = dto.attachments;

    const updatedComment = await this.commentRepository.save(comment);
    return this.mapCommentToDto(updatedComment, user);
  }

  async deleteComment(commentId: string, user: IUser): Promise<void> {
    const comment = await this.commentRepository.findOne({
      where: { id: commentId },
      relations: ['post'],
    });

    if (!comment) {
      throw new NotFoundException('Commentaire non trouvé');
    }

    if (comment.authorId !== user.id && !this.canModerateContent(user)) {
      throw new ForbiddenException('Vous ne pouvez supprimer que vos propres commentaires');
    }

    await this.postRepository.decrement({ id: comment.postId }, 'commentsCount', 1);

    if (comment.parentCommentId) {
      await this.commentRepository.decrement(
        { id: comment.parentCommentId },
        'repliesCount',
        1
      );
    }

    comment.deletedAt = new Date();
    await this.commentRepository.save(comment);
  }

  async getPostReactions(postId: string, reactionType?: ReactionType): Promise<any[]> {
    const whereCondition: any = {
      targetId: postId,
      targetType: ContentType.POST,
    };

    if (reactionType) {
      whereCondition.type = reactionType;
    }

    return await this.reactionRepository.find({
      where: whereCondition,
      order: { createdAt: 'DESC' },
    });
  }

  async getCommentReactions(commentId: string, reactionType?: ReactionType): Promise<any[]> {
    const whereCondition: any = {
      targetId: commentId,
      targetType: ContentType.COMMENT,
    };

    if (reactionType) {
      whereCondition.type = reactionType;
    }

    return await this.reactionRepository.find({
      where: whereCondition,
      order: { createdAt: 'DESC' },
    });
  }

  async bookmarkPost(user: IUser, postId: string): Promise<{ success: boolean; message: string }> {
    const post = await this.postRepository.findOne({
      where: { id: postId, deletedAt: null },
    });

    if (!post) {
      throw new NotFoundException('Post non trouvé');
    }

    const existingBookmark = await this.bookmarkRepository.findOne({
      where: { userId: user.id, postId },
    });

    if (existingBookmark) {
      throw new BadRequestException('Post déjà sauvegardé');
    }

    const bookmark = this.bookmarkRepository.create({
      userId: user.id,
      postId,
      createdAt: new Date(),
    });

    try {
      await this.bookmarkRepository.save(bookmark);
      return { success: true, message: 'Post sauvegardé avec succès' };
    } catch (error) {
      console.error('Error creating bookmark:', error);
      throw new InternalServerErrorException('Erreur lors de la sauvegarde du post');
    }
  }

  async unbookmarkPost(user: IUser, postId: string): Promise<{ success: boolean; message: string }> {
    const bookmark = await this.bookmarkRepository.findOne({
      where: { userId: user.id, postId },
    });

    if (!bookmark) {
      throw new NotFoundException('Bookmark non trouvé pour cet utilisateur');
    }

    try {
      await this.bookmarkRepository.remove(bookmark);
      return { success: true, message: 'Post retiré des favoris' };
    } catch (error) {
      console.error('Error removing bookmark:', error);
      throw new InternalServerErrorException('Erreur lors de la suppression du favori');
    }
  }

  async getBookmarkedPosts(user: IUser, page: number = 1, limit: number = 10): Promise<{
    posts: PostDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    try {
      const [bookmarks, total] = await this.bookmarkRepository.findAndCount({
        where: { userId: user.id },
        relations: ['post'],
        order: { createdAt: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      });

      const validBookmarks = bookmarks.filter(bookmark => 
        bookmark.post && !bookmark.post.deletedAt
      );

      const posts = await Promise.all(
        validBookmarks.map(bookmark => this.mapToDto(bookmark.post, user))
      );

      return {
        posts,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      console.error('Error getting bookmarked posts:', error);
      throw new InternalServerErrorException('Erreur lors de la récupération des favoris');
    }
  }

  async isPostBookmarked(user: IUser, postId: string): Promise<{ isBookmarked: boolean }> {
    try {
      const bookmark = await this.bookmarkRepository.findOne({
        where: { userId: user.id, postId },
      });

      return { isBookmarked: !!bookmark };
    } catch (error) {
      console.error('Error checking bookmark status:', error);
      return { isBookmarked: false };
    }
  }

  private async validateTargetExists(targetId: string, targetType: ContentType) {
    let repository;
    
    switch (targetType) {
      case ContentType.POST:
        repository = this.postRepository;
        break;
      case ContentType.COMMENT:
        repository = this.commentRepository;
        break;
      default:
        throw new BadRequestException('Invalid target type');
    }

    const target = await repository.findOne({ where: { id: targetId } });
    if (!target) {
      throw new NotFoundException('Target not found');
    }
    
    return target;
  }

  async getFeed(user: IUser, query: FeedQueryDto): Promise<FeedResponseDto> {
    const queryBuilder = this.postRepository
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.originalPost', 'originalPost')
      .where('post.deletedAt IS NULL');

    this.applyVisibilityFilters(queryBuilder, user, query);

    if (query.search) {
      queryBuilder.andWhere('LOWER(post.content) LIKE LOWER(:search)', {
        search: `%${query.search}%`
      });
    }

    if (query.tags && query.tags.length > 0) {
      const tagConditions = query.tags.map((_, index) => 
        `EXISTS (SELECT 1 FROM unnest(post.tags) AS tag WHERE LOWER(tag) LIKE LOWER(:tag${index}))`
      ).join(' OR ');
      
      queryBuilder.andWhere(`(${tagConditions})`);
      query.tags.forEach((tag, index) => {
        queryBuilder.setParameter(`tag${index}`, `%${tag}%`);
      });
    }

    this.applySorting(queryBuilder, query.sortBy || 'recent');

    const offset = ((query.page || 1) - 1) * (query.limit || 10);
    queryBuilder.skip(offset).take(query.limit || 10);

    try {
      const [posts, total] = await queryBuilder.getManyAndCount();

      const enrichedPosts = await Promise.all(
        posts.map(post => this.mapToDto(post, user))
      );

      return {
        posts: enrichedPosts,
        total,
        page: query.page || 1,
        limit: query.limit || 10,
        totalPages: Math.ceil(total / (query.limit || 10)),
        hasNext: (query.page || 1) < Math.ceil(total / (query.limit || 10)),
        hasPrev: (query.page || 1) > 1,
      };
    } catch (error) {
      console.error('Error in getFeed:', error);
      throw new InternalServerErrorException('Erreur lors du chargement du feed');
    }
  }

  async getPostById(postId: string, user: IUser): Promise<PostDto> {
    const post = await this.postRepository.findOne({
      where: { id: postId, deletedAt: null },
      relations: ['originalPost'],
    });

    if (!post) {
      throw new NotFoundException('Post non trouvé');
    }

    if (!this.canViewPost(post, user)) {
      throw new ForbiddenException('Vous n\'avez pas accès à ce post');
    }

    await this.recordPostView(postId, user);

    return this.mapToDto(post, user);
  }

  async getPostComments(postId: string, user: IUser, page: number = 1, limit: number = 20) {
    const post = await this.postRepository.findOne({
      where: { id: postId, deletedAt: null },
    });

    if (!post) {
      throw new NotFoundException('Post non trouvé');
    }

    if (!this.canViewPost(post, user)) {
      throw new ForbiddenException('Vous n\'avez pas accès à ce post');
    }

    const [comments, total] = await this.commentRepository.findAndCount({
      where: { 
        postId, 
        parentCommentId: null,
        deletedAt: null 
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const enrichedComments = await Promise.all(
      comments.map(comment => this.mapCommentToDto(comment, user))
    );

    return {
      comments: enrichedComments,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getCommentReplies(commentId: string, user: IUser, page: number = 1, limit: number = 10) {
    const parentComment = await this.commentRepository.findOne({
      where: { id: commentId, deletedAt: null },
    });

    if (!parentComment) {
      throw new NotFoundException('Commentaire non trouvé');
    }

    const [replies, total] = await this.commentRepository.findAndCount({
      where: { 
        parentCommentId: commentId,
        deletedAt: null 
      },
      order: { createdAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const enrichedReplies = await Promise.all(
      replies.map(reply => this.mapCommentToDto(reply, user))
    );

    return {
      replies: enrichedReplies,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async searchPosts(user: IUser, query: SearchQueryDto): Promise<SearchResultDto> {
    const queryBuilder = this.postRepository
      .createQueryBuilder('post')
      .where('post.deletedAt IS NULL')
      .andWhere('LOWER(post.content) LIKE LOWER(:search)', { 
        search: `%${query.query}%` 
      });

    this.applyVisibilityFilters(queryBuilder, user, { departmentOnly: false });

    queryBuilder
      .addSelect(
        'LENGTH(post.content) - LENGTH(REPLACE(LOWER(post.content), LOWER(:searchTerm), \'\'))',
        'relevance_score'
      )
      .setParameter('searchTerm', query.query)
      .orderBy('relevance_score', 'DESC')
      .addOrderBy('post.createdAt', 'DESC');

    const offset = ((query.page || 1) - 1) * (query.limit || 10);
    const [posts, total] = await queryBuilder
      .skip(offset)
      .take(query.limit || 10)
      .getManyAndCount();

    const enrichedPosts = await Promise.all(
      posts.map(post => this.mapToDto(post, user))
    );

    return {
      posts: enrichedPosts,
      total,
      page: query.page || 1,
      limit: query.limit || 10,
      totalPages: Math.ceil(total / (query.limit || 10)),
    };
  }

  async advancedSearch(user: IUser, options: {
    query?: string;
    author?: string;
    department?: string;
    tags?: string[];
    dateFrom?: Date;
    dateTo?: Date;
    hasImages?: boolean;
    hasFiles?: boolean;
    sortBy?: 'recent' | 'popular' | 'relevance';
    page?: number;
    limit?: number;
  }): Promise<SearchResultDto> {
    const queryBuilder = this.postRepository
      .createQueryBuilder('post')
      .where('post.deletedAt IS NULL');

    this.applyVisibilityFilters(queryBuilder, user, { departmentOnly: false });

    if (options.query) {
      queryBuilder.andWhere('LOWER(post.content) LIKE LOWER(:search)', { 
        search: `%${options.query}%` 
      });
    }

    if (options.author) {
      queryBuilder.andWhere('LOWER(post.authorName) LIKE LOWER(:author)', { 
        author: `%${options.author}%` 
      });
    }

    if (options.department) {
      queryBuilder.andWhere('post.authorDepartment = :department', { 
        department: options.department 
      });
    }

    if (options.tags && options.tags.length > 0) {
      const tagConditions = options.tags.map((_, index) => 
        `EXISTS (SELECT 1 FROM unnest(post.tags) AS tag WHERE LOWER(tag) LIKE LOWER(:tag${index}))`
      ).join(' OR ');
      
      queryBuilder.andWhere(`(${tagConditions})`);
      options.tags.forEach((tag, index) => {
        queryBuilder.setParameter(`tag${index}`, `%${tag}%`);
      });
    }

    if (options.dateFrom) {
      queryBuilder.andWhere('post.createdAt >= :dateFrom', { 
        dateFrom: options.dateFrom 
      });
    }

    if (options.dateTo) {
      queryBuilder.andWhere('post.createdAt <= :dateTo', { 
        dateTo: options.dateTo 
      });
    }

    if (options.hasImages !== undefined) {
      if (options.hasImages) {
        queryBuilder.andWhere(`(
          post.images IS NOT NULL AND 
          post.images != '[]' AND 
          post.images != '' AND
          array_length(string_to_array(trim(both '[]' from post.images::text), ','), 1) > 0
        )`);
      } else {
        queryBuilder.andWhere(`(
          post.images IS NULL OR 
          post.images = '[]' OR 
          post.images = ''
        )`);
      }
    }

    if (options.hasFiles !== undefined) {
      if (options.hasFiles) {
        queryBuilder.andWhere(`(
          post.files IS NOT NULL AND 
          post.files != '[]' AND 
          post.files != '' AND
          array_length(string_to_array(trim(both '[]' from post.files::text), ','), 1) > 0
        )`);
      } else {
        queryBuilder.andWhere(`(
          post.files IS NULL OR 
          post.files = '[]' OR 
          post.files = ''
        )`);
      }
    }

    this.applySorting(queryBuilder, options.sortBy || 'recent');

    const offset = ((options.page || 1) - 1) * (options.limit || 10);
    const [posts, total] = await queryBuilder
      .skip(offset)
      .take(options.limit || 10)
      .getManyAndCount();

    const enrichedPosts = await Promise.all(
      posts.map(post => this.mapToDto(post, user))
    );

    return {
      posts: enrichedPosts,
      total,
      page: options.page || 1,
      limit: options.limit || 10,
      totalPages: Math.ceil(total / (options.limit || 10)),
    };
  }

  async getTrending(user: IUser): Promise<TrendingDto> {
    const popularPosts = await this.postRepository.find({
      where: { deletedAt: null },
      order: { 
        likesCount: 'DESC',
        commentsCount: 'DESC',
        sharesCount: 'DESC',
      },
      take: 10,
    });

    const enrichedPosts = await Promise.all(
      popularPosts.map(post => this.mapToDto(post, user))
    );

    return {
      hashtags: [],
      popularPosts: enrichedPosts,
      activeUsers: [],
      departmentStats: [],
    };
  }

  // MÉTHODES PRIVÉES
  private extractMentions(content: string, additionalMentions: string[] = []): string[] {
    const mentionRegex = /@(\w+)/g;
    const matches = content.match(mentionRegex) || [];
    const extractedMentions = matches.map(match => match.substring(1));
    return [...new Set([...extractedMentions, ...additionalMentions])];
  }

  private extractHashtags(content: string, additionalTags: string[] = []): string[] {
    const hashtagRegex = /#(\w+)/g;
    const matches = content.match(hashtagRegex) || [];
    const extractedTags = matches.map(match => match.substring(1));
    return [...new Set([...extractedTags, ...additionalTags])];
  }

  private applyVisibilityFilters(
    queryBuilder: SelectQueryBuilder<Post>, 
    user: IUser, 
    query: FeedQueryDto
  ) {
    if (query.myDepartment) {
      queryBuilder.andWhere('post.authorDepartment = :userDepartment', { 
        userDepartment: user.department 
      });
      return;
    }

    if (query.department) {
      queryBuilder.andWhere('post.authorDepartment = :department', { 
        department: query.department 
      });
    }

    queryBuilder.andWhere(
      '(post.isPublic = true OR ' +
      '(post.departmentOnly = true AND post.authorDepartment = :userDepartment) OR ' +
      'post.authorId = :userId)',
      { userDepartment: user.department, userId: user.id }
    );

    if (query.followingOnly) {
      queryBuilder
        .innerJoin(
          'follows', 
          'follow', 
          'follow.followedId = post.authorId AND follow.followerId = :followerId AND follow.isActive = true',
          { followerId: user.id }
        );
    }
  }

  private applySorting(queryBuilder: SelectQueryBuilder<Post>, sortBy: string) {
    switch (sortBy) {
      case 'popular':
        queryBuilder
          .addSelect('(post.likesCount + post.commentsCount + post.sharesCount)', 'engagement_score')
          .orderBy('engagement_score', 'DESC')
          .addOrderBy('post.createdAt', 'DESC');
        break;
      case 'trending':
        queryBuilder
          .orderBy('post.viewsCount', 'DESC')
          .addOrderBy('post.createdAt', 'DESC');
        break;
      case 'recent':
      default:
        queryBuilder.orderBy('post.createdAt', 'DESC');
        break;
    }
  }
  
  private canViewPost(post: Post, user: IUser): boolean {
    if (user.roles.includes(Role.SUPER_ADMIN) || user.roles.includes(Role.ADMIN)) {
      return true;
    }

    if (post.authorId === user.id) {
      return true;
    }

    if (post.isPublic) {
      return true;
    }

    if (post.departmentOnly && post.authorDepartment === user.department) {
      return true;
    }

    return false;
  }

  private canModerateContent(user: IUser): boolean {
    return user.roles.includes(Role.SUPER_ADMIN) || 
           user.roles.includes(Role.ADMIN) || 
           user.roles.includes(Role.AGENT_EY);
  }

  private async incrementReactionCount(targetId: string, targetType: ContentType) {
    if (targetType === ContentType.POST) {
      await this.postRepository.increment({ id: targetId }, 'likesCount', 1);
    } else if (targetType === ContentType.COMMENT) {
      await this.commentRepository.increment({ id: targetId }, 'likesCount', 1);
    }
  }

  private async decrementReactionCount(targetId: string, targetType: ContentType) {
    if (targetType === ContentType.POST) {
      await this.postRepository.decrement({ id: targetId }, 'likesCount', 1);
    } else if (targetType === ContentType.COMMENT) {
      await this.commentRepository.decrement({ id: targetId }, 'likesCount', 1);
    }
  }

  private async recordPostView(postId: string, user: IUser) {
    const existingView = await this.postViewRepository.findOne({
      where: { postId, userId: user.id },
    });

    if (!existingView) {
      await this.postViewRepository.save({
        postId,
        userId: user.id,
        userName: user.fullName,
        userDepartment: user.department,
      });

      await this.postRepository.increment({ id: postId }, 'viewsCount', 1);
    }
  }

  private async mapToDto(post: Post, user: any): Promise<PostDto> {
    const userReaction = await this.reactionRepository.findOne({
      where: { 
        userId: user.id, 
        targetId: post.id, 
        targetType: ContentType.POST 
      },
    });

    return {
      id: post.id,
      content: post.content,
      authorId: post.authorId,
      authorName: post.authorName,
      authorProfilePicture: post.authorProfilePicture,
      authorDepartment: post.authorDepartment,
      images: post.images,
      files: post.files,
      tags: post.tags,
      mentions: post.mentions,
      isPublic: post.isPublic,
      departmentOnly: post.departmentOnly,
      allowComments: post.allowComments,
      allowShares: post.allowShares,
      isPinned: post.isPinned,
      isEdited: post.isEdited,
      originalPostId: post.originalPostId,
      originalAuthorName: post.originalAuthorName,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      sharesCount: post.sharesCount,
      viewsCount: post.viewsCount,
      isFlagged: post.isFlagged,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      isLiked: !!userReaction,
      userReaction: userReaction?.type,
      canEdit: post.authorId === user.id,
      canDelete: post.authorId === user.id || this.canModerateContent(user),
      canFlag: post.authorId !== user.id,
      originalPost: post.originalPost ? await this.mapToDto(post.originalPost, user) : undefined,
    };
  }

  private async mapCommentToDto(comment: Comment, user: IUser): Promise<CommentDto> {
    const userReaction = await this.reactionRepository.findOne({
      where: { 
        userId: user.id, 
        targetId: comment.id, 
        targetType: ContentType.COMMENT 
      },
    });

    return {
      id: comment.id,
      content: comment.content,
      authorId: comment.authorId,
      authorName: comment.authorName,
      authorProfilePicture: comment.authorProfilePicture,
      authorDepartment: comment.authorDepartment,
      postId: comment.postId,
      parentCommentId: comment.parentCommentId,
      mentions: comment.mentions,
      attachments: comment.attachments,
      isEdited: comment.isEdited,
      likesCount: comment.likesCount,
      repliesCount: comment.repliesCount,
      isFlagged: comment.isFlagged,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      isLiked: !!userReaction,
      userReaction: userReaction?.type,
      canEdit: comment.authorId === user.id,
      canDelete: comment.authorId === user.id || this.canModerateContent(user),
      canFlag: comment.authorId !== user.id,
    };
  }
}