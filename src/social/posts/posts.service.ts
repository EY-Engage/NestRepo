import { Injectable, NotFoundException, ForbiddenException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder, In } from 'typeorm';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { Reaction } from './entities/reaction.entity';
import { PostView } from './entities/post-view.entity';
import { Follow } from '../follows/entities/follow.entity';

import { NotificationsService } from '../../notifications/notifications.service';
import { KafkaProducerService } from '../../notifications/kafka/producer.service';
import { IntegrationService } from '../../integration/integration.service';
import { KAFKA_TOPICS } from '../../config/kafka.config';

import { IUser } from '../../shared/interfaces/user.interface';
import { ContentType } from 'src/shared/enums/content-type.enum';
import { NotificationType } from 'src/shared/enums/notification-type.enum';
import { ReactionType } from 'src/shared/enums/reaction-type.enum';
import { Role } from 'src/shared/enums/role.enum';
import { FeedQueryDto, FeedResponseDto } from '../dto/feed.dto';
import { SearchQueryDto, SearchResultDto } from '../dto/search.dto';
import { TrendingDto } from '../dto/trending.dto';
import { CommentDto } from './dto/comment.dto';
import { CreateCommentDto, UpdateCommentDto } from './dto/create-comment.dto';
import { CreatePostDto, UpdatePostDto, SharePostDto } from './dto/create-post.dto';
import { PostDto } from './dto/post.dto';
import { CreateReactionDto } from './dto/reaction.dto';
import { User } from './entities/user.entity';
import { FlagContentDto } from '../dto/moderation.dto';
import { Bookmark } from './entities/bookmark.entity';
import { Flag, FlagStatus } from './entities/flag.entity';

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
    @InjectRepository(Follow)
    private followRepository: Repository<Follow>,
    @InjectRepository(Bookmark)
    private bookmarkRepository: Repository<Bookmark>,
    private notificationsService: NotificationsService,
    private kafkaProducer: KafkaProducerService,
    private integrationService: IntegrationService,
  ) {}

  // SIGNALEMENT AVEC GESTION COMPLÈTE - VERSION CORRIGÉE
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

    // CORRECTION : Créer l'objet avec relatedFlagIds comme string JSON
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
      // CORRECTION : Convertir l'array en JSON string directement
      relatedFlagIds: JSON.stringify(relatedFlags.map(f => f.id)),
    };

    const flag = this.flagRepository.create(flagData);

    try {
      const savedFlag = await this.flagRepository.save(flag);

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

      try {
        await this.kafkaProducer.publish('CONTENT_FLAGGED', {
          flagId: savedFlag.id,
          targetId: dto.targetId,
          targetType: dto.targetType,
          reason: dto.reason,
          reportCount,
          isUrgent,
          reportedBy: {
            id: user.id,
            name: user.fullName,
            department: user.department,
          },
          contentAuthor: contentAuthor,
          timestamp: new Date(),
        });
      } catch (kafkaError) {
        console.warn('Erreur publication Kafka signalement:', kafkaError);
      }

      console.log('Signalement créé:', {
        flagId: savedFlag.id,
        targetId: dto.targetId,
        targetType: dto.targetType,
        reason: dto.reason,
        reportedBy: {
          id: user.id,
          name: user.fullName,
          department: user.department,
          email: user.email,
        },
        contentAuthor: {
          id: contentAuthor.id,
          name: contentAuthor.name,
          department: contentAuthor.department,
        },
        contentPreview: contentSnippet.substring(0, 200),
        isUrgent,
        reportCount,
        timestamp: new Date().toISOString(),
      });

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

  // CRÉATION ET GESTION DES POSTS
  async createPost(user: IUser, dto: CreatePostDto): Promise<PostDto> {
    if (!user.isActive) {
      throw new ForbiddenException('Votre compte doit être activé pour publier');
    }

    const mentions = this.extractMentions(dto.content, dto.mentions || []);
    const tags = this.extractHashtags(dto.content, dto.tags || []);

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

    if (dto.originalPostId) {
      const originalPost = await this.postRepository.findOne({
        where: { id: dto.originalPostId },
      });

      if (!originalPost) {
        throw new NotFoundException('Post original non trouvé');
      }

      if (!originalPost.allowShares) {
        throw new ForbiddenException('Ce post ne peut pas être partagé');
      }

      post.originalAuthorName = originalPost.authorName;
      
      await this.postRepository.increment(
        { id: originalPost.id },
        'sharesCount',
        1
      );
    }

    const savedPost = await this.postRepository.save(post);

    try {
      await this.kafkaProducer.publish(KAFKA_TOPICS.POST_CREATED, {
        id: savedPost.id,
        authorId: savedPost.authorId,
        authorName: savedPost.authorName,
        authorDepartment: savedPost.authorDepartment,
        content: savedPost.content.substring(0, 200),
        isPublic: savedPost.isPublic,
        departmentOnly: savedPost.departmentOnly,
        mentions: savedPost.mentions,
        timestamp: new Date(),
      });
    } catch (error) {
      console.warn('Erreur publication Kafka:', error);
    }

    if (mentions.length > 0) {
      await this.notifyMentionedUsers(savedPost, mentions, user);
    }

    try {
      await this.integrationService.notifyDotNetOfSocialActivity({
        userId: user.id,
        activityType: 'POST_CREATED',
        targetId: savedPost.id,
        details: {
          postId: savedPost.id,
          content: savedPost.content.substring(0, 100),
          isPublic: savedPost.isPublic,
          departmentOnly: savedPost.departmentOnly,
        },
      });
    } catch (error) {
      console.warn('Erreur notification .NET:', error);
    }

    return this.mapToDto(savedPost, user);
  }

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

  // GESTION DES COMMENTAIRES
  async createComment(user: IUser, dto: CreateCommentDto): Promise<CommentDto> {
    const post = await this.postRepository.findOne({
      where: { id: dto.postId },
    });

    if (!post) {
      throw new NotFoundException('Post non trouvé');
    }

    if (!post.allowComments) {
      throw new ForbiddenException('Les commentaires sont désactivés pour ce post');
    }

    let parentComment = null;
    if (dto.parentCommentId) {
      parentComment = await this.commentRepository.findOne({
        where: { id: dto.parentCommentId, postId: dto.postId },
      });

      if (!parentComment) {
        throw new NotFoundException('Commentaire parent non trouvé');
      }
    }

    const mentions = this.extractMentions(dto.content, dto.mentions || []);

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

    const savedComment = await this.commentRepository.save(comment);

    await this.postRepository.increment({ id: dto.postId }, 'commentsCount', 1);

    if (parentComment) {
      await this.commentRepository.increment(
        { id: parentComment.id },
        'repliesCount',
        1
      );
    }

    try {
      await this.kafkaProducer.publish(KAFKA_TOPICS.POST_COMMENTED, {
        id: savedComment.id,
        postId: post.id,
        postAuthorId: post.authorId,
        authorId: savedComment.authorId,
        authorName: savedComment.authorName,
        content: savedComment.content.substring(0, 200),
        mentions: savedComment.mentions,
        timestamp: new Date(),
      });

      if (post.authorId !== user.id) {
        await this.notificationsService.createNotification({
          type: NotificationType.POST_COMMENTED,
          title: 'Nouveau commentaire',
          content: `${user.fullName} a commenté votre publication.`,
          userId: post.authorId,
          senderId: user.id,
          senderName: user.fullName,
          targetId: post.id,
          targetType: 'post',
          actionUrl: `/social/posts/${post.id}#comment-${savedComment.id}`,
          data: {
            postId: post.id,
            commentId: savedComment.id,
            commentContent: savedComment.content.substring(0, 100),
          },
        });
      }
    } catch (error) {
      console.warn('Erreur notifications:', error);
    }

    if (mentions.length > 0) {
      await this.notifyMentionedUsersInComment(savedComment, mentions, user);
    }

    return this.mapCommentToDto(savedComment, user);
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

  // GESTION DES RÉACTIONS
  async toggleReaction(user: IUser, dto: CreateReactionDto): Promise<{ 
    action: 'added' | 'removed' | 'updated'; 
    reaction?: any 
  }> {
    try {
      await this.validateTargetExists(dto.targetId, dto.targetType);

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
          try {
            await this.decrementReactionCount(dto.targetId, dto.targetType);
          } catch (error) {
            console.error('Error decrementing reaction count:', error);
          }
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
        
        try {
          await this.incrementReactionCount(dto.targetId, dto.targetType);
        } catch (error) {
          console.error('Error incrementing reaction count:', error);
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

  // GESTION DES BOOKMARKS/FAVORIS
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

  // FEED ET RÉCUPÉRATION DES POSTS
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

  private async notifyContentAuthor(target: any, user: IUser, reactionType: ReactionType) {
    if (target.authorId === user.id) return;

    const isPost = target.hasOwnProperty('allowComments');
    const notificationType = isPost ? NotificationType.POST_LIKED : NotificationType.POST_COMMENTED;
    const content = isPost 
      ? `${user.fullName} a aimé votre publication` 
      : `${user.fullName} a aimé votre commentaire`;

    try {
      await this.notificationsService.createNotification({
        type: notificationType,
        title: 'Nouvelle réaction',
        content,
        userId: target.authorId,
        senderId: user.id,
        senderName: user.fullName,
        targetId: isPost ? target.id : target.postId,
        targetType: isPost ? 'post' : 'comment',
        actionUrl: isPost ? `/social/posts/${target.id}` : `/social/posts/${target.postId}#comment-${target.id}`,
        data: {
          reactionType,
          targetId: target.id,
          targetType: isPost ? 'post' : 'comment',
        },
      });
    } catch (error) {
      console.warn('Erreur notification:', error);
    }
  }

  private async notifyMentionedUsers(post: Post, mentions: string[], author: IUser) {
    console.log('Mentions à traiter:', mentions);
  }

  private async notifyMentionedUsersInComment(comment: Comment, mentions: string[], author: IUser) {
    console.log('Mentions dans commentaire à traiter:', mentions);
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

    const isFollowing = await this.followRepository.findOne({
      where: { 
        followerId: user.id, 
        followedId: post.authorId, 
        isActive: true 
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
      isFollowingAuthor: !!isFollowing,
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