import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Like, ILike, SelectQueryBuilder } from 'typeorm';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { Reaction } from './entities/reaction.entity';
import { Flag, FlagStatus } from './entities/flag.entity';
import { PostView } from './entities/post-view.entity';
import { Bookmark } from './entities/bookmark.entity';
import { User } from './entities/user.entity';
import { CreatePostDto, UpdatePostDto, SharePostDto, MentionSearchDto } from './dto/create-post.dto';
import { CreateCommentDto, UpdateCommentDto } from './dto/create-comment.dto';
import { CreateReactionDto } from './dto/reaction.dto';
import { PostDto } from './dto/post.dto';
import { CommentDto } from './dto/comment.dto';
import { ReactionDto } from './dto/reaction.dto';
import { FeedQueryDto, FeedResponseDto } from '../dto/feed.dto';
import { SearchQueryDto, SearchResultDto } from '../dto/search.dto';
import { TrendingDto } from '../dto/trending.dto';
import { FlagContentDto } from '../dto/moderation.dto';
import { IUser } from '../../shared/interfaces/user.interface';
import { ContentType } from '../../shared/enums/content-type.enum';
import { ReactionType } from '../../shared/enums/reaction-type.enum';
import { Department } from '../../shared/enums/department.enum';
import { NotificationsService } from '../../notifications/notifications.service';
import { Role } from 'src/shared/enums/role.enum';

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    @InjectRepository(Reaction)
    private readonly reactionRepository: Repository<Reaction>,
    @InjectRepository(Flag)
    private readonly flagRepository: Repository<Flag>,
    @InjectRepository(PostView)
    private readonly postViewRepository: Repository<PostView>,
    @InjectRepository(Bookmark)
    private readonly bookmarkRepository: Repository<Bookmark>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly notificationsService: NotificationsService,
  ) {}

  // =============== POSTS ===============

  async createPost(user: IUser, dto: CreatePostDto): Promise<PostDto> {
    try {
      this.logger.log(`📝 Creating post for user ${user.id}: ${dto.content.substring(0, 50)}...`);

      // Résoudre les mentions avant de créer le post
      const resolvedMentions = await this.resolveMentionsToUserIds(dto.mentions || []);

      const post = this.postRepository.create({
        content: dto.content,
        authorId: user.id,
        authorName: user.fullName,
        authorProfilePicture: user.profilePicture,
        authorDepartment: user.department,
        images: dto.images,
        files: dto.files,
        tags: dto.tags,
        mentions: resolvedMentions, // Stocker les IDs des utilisateurs mentionnés
        isPublic: dto.isPublic ?? true,
        departmentOnly: dto.departmentOnly ?? false,
        allowComments: dto.allowComments ?? true,
        allowShares: dto.allowShares ?? true,
        originalPostId: dto.originalPostId,
      });

      const savedPost = await this.postRepository.save(post);
      this.logger.log(`✅ Post created successfully: ${savedPost.id}`);

      // Envoyer des notifications pour les mentions
      if (resolvedMentions.length > 0) {
        await this.notifyMentionedUsers(savedPost, resolvedMentions);
      }

      return this.mapToPostDto(savedPost, user);
    } catch (error) {
      this.logger.error(`💥 Error creating post: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getFeed(user: IUser, query: FeedQueryDto): Promise<FeedResponseDto> {
    try {
      this.logger.log(`📰 Getting feed for user ${user.id} with query:`, query);

      const queryBuilder = this.postRepository
        .createQueryBuilder('post')
        .where('post.deletedAt IS NULL');

      // Filtres de visibilité
      if (query.followingOnly) {
        // TODO: Implémenter la logique de suivi
        queryBuilder.andWhere('1=0'); // Temporaire
      } else if (query.myDepartment || query.departmentOnly) {
        queryBuilder.andWhere('post.authorDepartment = :department', { 
          department: user.department 
        });
      } else if (query.department) {
        queryBuilder.andWhere('post.authorDepartment = :department', { 
          department: query.department 
        });
      } else {
        // Posts publics ou du département de l'utilisateur
        queryBuilder.andWhere(
          '(post.isPublic = true OR (post.departmentOnly = true AND post.authorDepartment = :userDept))',
          { userDept: user.department }
        );
      }

      // Recherche textuelle
      if (query.search) {
        queryBuilder.andWhere(
          '(LOWER(post.content) LIKE LOWER(:search) OR LOWER(post.authorName) LIKE LOWER(:search))',
          { search: `%${query.search}%` }
        );
      }

      // Filtres par tags
      if (query.tags && query.tags.length > 0) {
        queryBuilder.andWhere('post.tags && :tags', { tags: query.tags });
      }

      // Tri
      switch (query.sortBy) {
        case 'popular':
          queryBuilder.orderBy('(post.likesCount + post.commentsCount + post.sharesCount)', 'DESC');
          break;
        case 'trending':
          queryBuilder.orderBy('post.viewsCount', 'DESC');
          break;
        default:
          queryBuilder.orderBy('post.createdAt', 'DESC');
      }

      // Pagination
      const page = query.page || 1;
      const limit = Math.min(query.limit || 20, 50);
      queryBuilder.skip((page - 1) * limit).take(limit);

      const [posts, total] = await queryBuilder.getManyAndCount();

      const postDtos = await Promise.all(
        posts.map(post => this.mapToPostDto(post, user))
      );

      return {
        posts: postDtos,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      };
    } catch (error) {
      this.logger.error(`💥 Error getting feed: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getPostById(postId: string, user: IUser): Promise<PostDto> {
    try {
      const post = await this.postRepository.findOne({
        where: { id: postId, deletedAt: null },
      });

      if (!post) {
        throw new NotFoundException('Post non trouvé');
      }

      // Vérifier les permissions de lecture
      if (!this.canUserViewPost(post, user)) {
        throw new ForbiddenException('Vous n\'avez pas accès à ce post');
      }

      // Enregistrer la vue
      await this.recordPostView(postId, user);

      return this.mapToPostDto(post, user);
    } catch (error) {
      this.logger.error(`💥 Error getting post by ID: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updatePost(postId: string, user: IUser, dto: UpdatePostDto): Promise<PostDto> {
    try {
      const post = await this.postRepository.findOne({
        where: { id: postId, deletedAt: null },
      });

      if (!post) {
        throw new NotFoundException('Post non trouvé');
      }

      if (post.authorId !== user.id) {
        throw new ForbiddenException('Vous ne pouvez modifier que vos propres posts');
      }

      // Résoudre les nouvelles mentions
      const resolvedMentions = dto.mentions ? await this.resolveMentionsToUserIds(dto.mentions) : post.mentions;

      Object.assign(post, {
        ...dto,
        mentions: resolvedMentions,
        isEdited: true,
        updatedAt: new Date(),
      });

      const updatedPost = await this.postRepository.save(post);

      // Notifier les nouvelles mentions
      if (resolvedMentions && resolvedMentions.length > 0) {
        const newMentions = resolvedMentions.filter(mention => !post.mentions?.includes(mention));
        if (newMentions.length > 0) {
          await this.notifyMentionedUsers(updatedPost, newMentions);
        }
      }

      return this.mapToPostDto(updatedPost, user);
    } catch (error) {
      this.logger.error(`💥 Error updating post: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deletePost(postId: string, user: IUser): Promise<void> {
    try {
      const post = await this.postRepository.findOne({
        where: { id: postId, deletedAt: null },
      });

      if (!post) {
        throw new NotFoundException('Post non trouvé');
      }

      if (post.authorId !== user.id && !user.roles.includes(Role.ADMIN) && !user.roles.includes(Role.SUPER_ADMIN)) {
        throw new ForbiddenException('Vous ne pouvez supprimer que vos propres posts');
      }

      post.deletedAt = new Date();
      await this.postRepository.save(post);

      this.logger.log(`🗑️ Post ${postId} deleted by user ${user.id}`);
    } catch (error) {
      this.logger.error(`💥 Error deleting post: ${error.message}`, error.stack);
      throw error;
    }
  }

  async sharePost(user: IUser, dto: SharePostDto): Promise<PostDto> {
    try {
      const originalPost = await this.postRepository.findOne({
        where: { id: dto.originalPostId, deletedAt: null },
      });

      if (!originalPost) {
        throw new NotFoundException('Post original non trouvé');
      }

      if (!originalPost.allowShares) {
        throw new ForbiddenException('Ce post ne peut pas être partagé');
      }

      // Résoudre les mentions dans le commentaire de partage
      const resolvedMentions = dto.mentions ? await this.resolveMentionsToUserIds(dto.mentions) : [];

      const sharePost = this.postRepository.create({
        content: dto.comment || `Partage de ${originalPost.authorName}`,
        authorId: user.id,
        authorName: user.fullName,
        authorProfilePicture: user.profilePicture,
        authorDepartment: user.department,
        mentions: resolvedMentions,
        isPublic: dto.isPublic ?? true,
        departmentOnly: dto.departmentOnly ?? false,
        allowComments: true,
        allowShares: true,
        originalPostId: dto.originalPostId,
        originalAuthorName: originalPost.authorName,
      });

      const savedShare = await this.postRepository.save(sharePost);

      // Incrémenter le compteur de partages du post original
      await this.postRepository.increment({ id: dto.originalPostId }, 'sharesCount', 1);

      // Notifier l'auteur du post original
      if (originalPost.authorId !== user.id) {
        await this.notificationsService.notifyPostComment(
          originalPost,
          user.id,
          user.fullName,
          originalPost.authorId,
          originalPost.authorName
        );
      }

      // Notifier les mentions dans le commentaire de partage
      if (resolvedMentions.length > 0) {
        await this.notifyMentionedUsers(savedShare, resolvedMentions);
      }

      return this.mapToPostDto(savedShare, user);
    } catch (error) {
      this.logger.error(`💥 Error sharing post: ${error.message}`, error.stack);
      throw error;
    }
  }

  // =============== COMMENTS ===============

  async createComment(user: IUser, dto: CreateCommentDto): Promise<CommentDto> {
    try {
      const post = await this.postRepository.findOne({
        where: { id: dto.postId, deletedAt: null },
      });

      if (!post) {
        throw new NotFoundException('Post non trouvé');
      }

      if (!post.allowComments) {
        throw new ForbiddenException('Les commentaires ne sont pas autorisés sur ce post');
      }

      // Résoudre les mentions
      const resolvedMentions = await this.resolveMentionsToUserIds(dto.mentions || []);

      const comment = this.commentRepository.create({
        content: dto.content,
        authorId: user.id,
        authorName: user.fullName,
        authorProfilePicture: user.profilePicture,
        authorDepartment: user.department,
        postId: dto.postId,
        parentCommentId: dto.parentCommentId,
        mentions: resolvedMentions,
        attachments: dto.attachments,
      });

      const savedComment = await this.commentRepository.save(comment);

      // Incrémenter le compteur de commentaires
      await this.postRepository.increment({ id: dto.postId }, 'commentsCount', 1);

      // Notifier l'auteur du post
      if (post.authorId !== user.id) {
        await this.notificationsService.notifyPostComment(
          post,
          user.id,
          user.fullName,
          post.authorId,
          post.authorName
        );
      }

      // Notifier les mentions
      if (resolvedMentions.length > 0) {
        await this.notifyMentionedUsersInComment(savedComment, resolvedMentions);
      }

      return this.mapToCommentDto(savedComment, user);
    } catch (error) {
      this.logger.error(`💥 Error creating comment: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getPostComments(postId: string, user: IUser, page: number = 1, limit: number = 20) {
    try {
      const post = await this.postRepository.findOne({
        where: { id: postId, deletedAt: null },
      });

      if (!post) {
        throw new NotFoundException('Post non trouvé');
      }

      if (!this.canUserViewPost(post, user)) {
        throw new ForbiddenException('Vous n\'avez pas accès à ce post');
      }

      const [comments, total] = await this.commentRepository.findAndCount({
        where: { 
          postId, 
          parentCommentId: null, // Seulement les commentaires de niveau supérieur
          deletedAt: null 
        },
        order: { createdAt: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      });

      const commentDtos = await Promise.all(
        comments.map(comment => this.mapToCommentDto(comment, user))
      );

      return {
        comments: commentDtos,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      };
    } catch (error) {
      this.logger.error(`💥 Error getting post comments: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateComment(commentId: string, user: IUser, dto: UpdateCommentDto): Promise<CommentDto> {
    try {
      const comment = await this.commentRepository.findOne({
        where: { id: commentId, deletedAt: null },
      });

      if (!comment) {
        throw new NotFoundException('Commentaire non trouvé');
      }

      if (comment.authorId !== user.id) {
        throw new ForbiddenException('Vous ne pouvez modifier que vos propres commentaires');
      }

      // Résoudre les nouvelles mentions
      const resolvedMentions = dto.mentions ? await this.resolveMentionsToUserIds(dto.mentions) : comment.mentions;

      Object.assign(comment, {
        ...dto,
        mentions: resolvedMentions,
        isEdited: true,
        updatedAt: new Date(),
      });

      const updatedComment = await this.commentRepository.save(comment);

      // Notifier les nouvelles mentions
      if (resolvedMentions && resolvedMentions.length > 0) {
        const newMentions = resolvedMentions.filter(mention => !comment.mentions?.includes(mention));
        if (newMentions.length > 0) {
          await this.notifyMentionedUsersInComment(updatedComment, newMentions);
        }
      }

      return this.mapToCommentDto(updatedComment, user);
    } catch (error) {
      this.logger.error(`💥 Error updating comment: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteComment(commentId: string, user: IUser): Promise<void> {
    try {
      const comment = await this.commentRepository.findOne({
        where: { id: commentId, deletedAt: null },
      });

      if (!comment) {
        throw new NotFoundException('Commentaire non trouvé');
      }

      if (comment.authorId !== user.id && !user.roles.includes(Role.ADMIN) && !user.roles.includes(Role.AGENT_EY)) {
        throw new ForbiddenException('Vous ne pouvez supprimer que vos propres commentaires');
      }

      comment.deletedAt = new Date();
      await this.commentRepository.save(comment);

      // Décrémenter le compteur de commentaires
      await this.postRepository.decrement({ id: comment.postId }, 'commentsCount', 1);

      this.logger.log(`🗑️ Comment ${commentId} deleted by user ${user.id}`);
    } catch (error) {
      this.logger.error(`💥 Error deleting comment: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getCommentReplies(commentId: string, user: IUser, page: number = 1, limit: number = 10) {
    try {
      const [replies, total] = await this.commentRepository.findAndCount({
        where: { 
          parentCommentId: commentId,
          deletedAt: null 
        },
        order: { createdAt: 'ASC' },
        skip: (page - 1) * limit,
        take: limit,
      });

      const replyDtos = await Promise.all(
        replies.map(reply => this.mapToCommentDto(reply, user))
      );

      return {
        replies: replyDtos,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      };
    } catch (error) {
      this.logger.error(`💥 Error getting comment replies: ${error.message}`, error.stack);
      throw error;
    }
  }

  // =============== REACTIONS ===============

  async toggleReaction(user: IUser, dto: CreateReactionDto) {
    try {
      // Vérifier que la cible existe
      let target: Post | Comment | null = null;
      
      if (dto.targetType === ContentType.POST) {
        target = await this.postRepository.findOne({
          where: { id: dto.targetId, deletedAt: null },
        });
      } else if (dto.targetType === ContentType.COMMENT) {
        target = await this.commentRepository.findOne({
          where: { id: dto.targetId, deletedAt: null },
        });
      }

      if (!target) {
        throw new NotFoundException('Contenu non trouvé');
      }

      // Chercher une réaction existante
      const existingReaction = await this.reactionRepository.findOne({
        where: {
          userId: user.id,
          targetId: dto.targetId,
          targetType: dto.targetType,
        },
      });

      if (existingReaction) {
        if (existingReaction.type === dto.type) {
          // Supprimer la réaction
          await this.reactionRepository.remove(existingReaction);
          
          // Décrémenter le compteur
          if (dto.targetType === ContentType.POST) {
            await this.postRepository.decrement({ id: dto.targetId }, 'likesCount', 1);
          } else {
            await this.commentRepository.decrement({ id: dto.targetId }, 'likesCount', 1);
          }

          return { action: 'removed' };
        } else {
          // Modifier la réaction
          existingReaction.type = dto.type;
          const updatedReaction = await this.reactionRepository.save(existingReaction);
          return { 
            action: 'updated', 
            reaction: this.mapToReactionDto(updatedReaction) 
          };
        }
      } else {
        // Créer une nouvelle réaction
        const reaction = this.reactionRepository.create({
          type: dto.type,
          userId: user.id,
          userName: user.fullName,
          userProfilePicture: user.profilePicture,
          userDepartment: user.department,
          targetId: dto.targetId,
          targetType: dto.targetType,
        });

        const savedReaction = await this.reactionRepository.save(reaction);

        // Incrémenter le compteur
        if (dto.targetType === ContentType.POST) {
          await this.postRepository.increment({ id: dto.targetId }, 'likesCount', 1);
        } else {
          await this.commentRepository.increment({ id: dto.targetId }, 'likesCount', 1);
        }

        return { 
          action: 'added', 
          reaction: this.mapToReactionDto(savedReaction) 
        };
      }
    } catch (error) {
      this.logger.error(`💥 Error toggling reaction: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getPostReactions(postId: string, reactionType?: ReactionType): Promise<ReactionDto[]> {
    try {
      const where: any = {
        targetId: postId,
        targetType: ContentType.POST,
      };

      if (reactionType) {
        where.type = reactionType;
      }

      const reactions = await this.reactionRepository.find({
        where,
        order: { createdAt: 'DESC' },
      });

      return reactions.map(reaction => this.mapToReactionDto(reaction));
    } catch (error) {
      this.logger.error(`💥 Error getting post reactions: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getCommentReactions(commentId: string, reactionType?: ReactionType): Promise<ReactionDto[]> {
    try {
      const where: any = {
        targetId: commentId,
        targetType: ContentType.COMMENT,
      };

      if (reactionType) {
        where.type = reactionType;
      }

      const reactions = await this.reactionRepository.find({
        where,
        order: { createdAt: 'DESC' },
      });

      return reactions.map(reaction => this.mapToReactionDto(reaction));
    } catch (error) {
      this.logger.error(`💥 Error getting comment reactions: ${error.message}`, error.stack);
      throw error;
    }
  }

  // =============== SEARCH ===============

  async searchPosts(user: IUser, query: SearchQueryDto): Promise<SearchResultDto> {
    try {
      const queryBuilder = this.postRepository
        .createQueryBuilder('post')
        .where('post.deletedAt IS NULL')
        .andWhere(
          '(post.isPublic = true OR (post.departmentOnly = true AND post.authorDepartment = :userDept))',
          { userDept: user.department }
        );

      // Recherche textuelle
      queryBuilder.andWhere(
        '(LOWER(post.content) LIKE LOWER(:search) OR LOWER(post.authorName) LIKE LOWER(:search))',
        { search: `%${query.query}%` }
      );

      // Filtre par département
      if (query.department) {
        queryBuilder.andWhere('post.authorDepartment = :department', { 
          department: query.department 
        });
      }

      // Pagination
      const page = query.page || 1;
      const limit = Math.min(query.limit || 20, 50);
      queryBuilder
        .orderBy('post.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [posts, total] = await queryBuilder.getManyAndCount();

      const postDtos = await Promise.all(
        posts.map(post => this.mapToPostDto(post, user))
      );

      return {
        posts: postDtos,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      this.logger.error(`💥 Error searching posts: ${error.message}`, error.stack);
      throw error;
    }
  }

  async advancedSearch(user: IUser, options: any): Promise<SearchResultDto> {
    try {
      const queryBuilder = this.postRepository
        .createQueryBuilder('post')
        .where('post.deletedAt IS NULL');

      // Filtres de visibilité
      queryBuilder.andWhere(
        '(post.isPublic = true OR (post.departmentOnly = true AND post.authorDepartment = :userDept))',
        { userDept: user.department }
      );

      // Recherche textuelle
      if (options.query) {
        queryBuilder.andWhere(
          '(LOWER(post.content) LIKE LOWER(:search) OR LOWER(post.authorName) LIKE LOWER(:search))',
          { search: `%${options.query}%` }
        );
      }

      // Filtre par auteur
      if (options.author) {
        queryBuilder.andWhere('post.authorId = :authorId', { authorId: options.author });
      }

      // Filtre par département
      if (options.department) {
        queryBuilder.andWhere('post.authorDepartment = :department', { 
          department: options.department 
        });
      }

      // Filtre par tags
      if (options.tags && options.tags.length > 0) {
        queryBuilder.andWhere('post.tags && :tags', { tags: options.tags });
      }

      // Filtres par dates
      if (options.dateFrom) {
        queryBuilder.andWhere('post.createdAt >= :dateFrom', { dateFrom: options.dateFrom });
      }

      if (options.dateTo) {
        queryBuilder.andWhere('post.createdAt <= :dateTo', { dateTo: options.dateTo });
      }

      // Filtres par contenu
      if (options.hasImages) {
        queryBuilder.andWhere('post.images IS NOT NULL AND array_length(post.images, 1) > 0');
      }

      if (options.hasFiles) {
        queryBuilder.andWhere('post.files IS NOT NULL AND array_length(post.files, 1) > 0');
      }

      // Tri
      switch (options.sortBy) {
        case 'popular':
          queryBuilder.orderBy('(post.likesCount + post.commentsCount + post.sharesCount)', 'DESC');
          break;
        case 'relevance':
          // TODO: Implémenter un score de pertinence
          queryBuilder.orderBy('post.createdAt', 'DESC');
          break;
        default:
          queryBuilder.orderBy('post.createdAt', 'DESC');
      }

      // Pagination
      const page = options.page || 1;
      const limit = Math.min(options.limit || 20, 50);
      queryBuilder.skip((page - 1) * limit).take(limit);

      const [posts, total] = await queryBuilder.getManyAndCount();

      const postDtos = await Promise.all(
        posts.map(post => this.mapToPostDto(post, user))
      );

      return {
        posts: postDtos,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      this.logger.error(`💥 Error in advanced search: ${error.message}`, error.stack);
      throw error;
    }
  }

  // =============== TRENDING ===============

async getTrending(user: IUser): Promise<TrendingDto> {
  try {
    // Posts populaires des 7 derniers jours
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const popularPosts = await this.postRepository
      .createQueryBuilder('post')
      .where('post.deletedAt IS NULL')
      .andWhere('post.createdAt >= :sevenDaysAgo', { sevenDaysAgo })
      .andWhere(
        '(post.isPublic = true OR (post.departmentOnly = true AND post.authorDepartment = :userDept))',
        { userDept: user.department }
      )
      .orderBy('(post.likesCount + post.commentsCount + post.sharesCount + post.viewsCount)', 'DESC')
      .take(10)
      .getMany();

    const popularPostDtos = await Promise.all(
      popularPosts.map(post => this.mapToPostDto(post, user))
    );

    // Hashtags populaires (ajout de la propriété `posts`)
    const hashtags: { tag: string; count: number; trend: "up" | "stable" | "down"; posts: PostDto[] }[] = [
      { tag: 'innovation', count: 25, trend: "up", posts: [] },
      { tag: 'teamwork', count: 18, trend: "stable", posts: [] },
      { tag: 'digital', count: 15, trend: "up", posts: [] },
      { tag: 'consulting', count: 12, trend: "down", posts: [] },
    ];

    // Utilisateurs actifs (simulation)
    const activeUsers = await this.userRepository
      .createQueryBuilder('user')
      .where('user.isActive = true')
      .orderBy('user.createdAt', 'DESC')
      .take(5)
      .getMany();

    const activeUserDtos = activeUsers.map(user => ({
      id: user.id,
      fullName: user.fullName,
      department: user.department,
      profilePicture: user.profilePicture,
      postsCount: 0, // TODO: Calculer
      engagementRate: 0, // TODO: Calculer
    }));

    // Statistiques par département (simulation)
    const departmentStats = Object.values(Department).map(dept => ({
      department: dept,
      postsCount: 0, // TODO: Calculer
      activeUsers: 0, // TODO: Calculer
      engagementRate: 0, // TODO: Calculer
    }));

    return {
      hashtags,
      popularPosts: popularPostDtos,
      activeUsers: activeUserDtos,
      departmentStats,
    };
  } catch (error) {
    this.logger.error(`💥 Error getting trending: ${error.message}`, error.stack);
    throw error;
  }
}

  // =============== BOOKMARKS ===============

  async bookmarkPost(user: IUser, postId: string) {
    try {
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
        throw new ConflictException('Post déjà en favoris');
      }

      const bookmark = this.bookmarkRepository.create({
        userId: user.id,
        postId,
      });

      await this.bookmarkRepository.save(bookmark);

      return { success: true, message: 'Post ajouté aux favoris' };
    } catch (error) {
      this.logger.error(`💥 Error bookmarking post: ${error.message}`, error.stack);
      throw error;
    }
  }

  async unbookmarkPost(user: IUser, postId: string) {
    try {
      const result = await this.bookmarkRepository.delete({
        userId: user.id,
        postId,
      });

      if (result.affected === 0) {
        throw new NotFoundException('Favori non trouvé');
      }

      return { success: true, message: 'Post retiré des favoris' };
    } catch (error) {
      this.logger.error(`💥 Error unbookmarking post: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getBookmarkedPosts(user: IUser, page: number = 1, limit: number = 20) {
    try {
      const [bookmarks, total] = await this.bookmarkRepository.findAndCount({
        where: { userId: user.id },
        order: { createdAt: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      });

      const postIds = bookmarks.map(bookmark => bookmark.postId);
      
      if (postIds.length === 0) {
        return {
          posts: [],
          total: 0,
          page,
          limit,
          totalPages: 0,
        };
      }

      const posts = await this.postRepository.find({
        where: { 
          id: In(postIds),
          deletedAt: null 
        },
        order: { createdAt: 'DESC' },
      });

      const postDtos = await Promise.all(
        posts.map(post => this.mapToPostDto(post, user))
      );

      return {
        posts: postDtos,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      this.logger.error(`💥 Error getting bookmarked posts: ${error.message}`, error.stack);
      throw error;
    }
  }

  async isPostBookmarked(user: IUser, postId: string) {
    try {
      const bookmark = await this.bookmarkRepository.findOne({
        where: { userId: user.id, postId },
      });

      return { isBookmarked: !!bookmark };
    } catch (error) {
      this.logger.error(`💥 Error checking bookmark status: ${error.message}`, error.stack);
      return { isBookmarked: false };
    }
  }

  // =============== FLAGGING ===============

  async flagContent(user: IUser, dto: FlagContentDto) {
    try {
      // Vérifier que le contenu existe
      let content: Post | Comment | null = null;
      let contentAuthor: any = null;

      if (dto.targetType === ContentType.POST) {
        content = await this.postRepository.findOne({
          where: { id: dto.targetId, deletedAt: null },
        });
        if (content) {
          contentAuthor = {
            id: content.authorId,
            name: content.authorName,
            department: content.authorDepartment,
          };
        }
      } else if (dto.targetType === ContentType.COMMENT) {
        content = await this.commentRepository.findOne({
          where: { id: dto.targetId, deletedAt: null },
        });
        if (content) {
          contentAuthor = {
            id: content.authorId,
            name: content.authorName,
            department: content.authorDepartment,
          };
        }
      }

      if (!content) {
        throw new NotFoundException('Contenu non trouvé');
      }

      // Vérifier que l'utilisateur ne signale pas son propre contenu
      if (contentAuthor.id === user.id) {
        throw new ForbiddenException('Vous ne pouvez pas signaler votre propre contenu');
      }

      // Vérifier si l'utilisateur a déjà signalé ce contenu
      const existingFlag = await this.flagRepository.findOne({
        where: {
          targetId: dto.targetId,
          targetType: dto.targetType,
          reportedById: user.id,
        },
      });

      if (existingFlag) {
        throw new ConflictException('Vous avez déjà signalé ce contenu');
      }

      // Créer le signalement
      const flag = this.flagRepository.create({
        targetId: dto.targetId,
        targetType: dto.targetType,
        reason: dto.reason,
        description: dto.description,
        reportedById: user.id,
        reportedByName: user.fullName,
        reportedByEmail: user.email,
        reportedByDepartment: user.department.toString(),
        contentAuthorId: contentAuthor.id,
        contentAuthorName: contentAuthor.name,
        contentAuthorDepartment: contentAuthor.department.toString(),
        contentSnippet: content.content.substring(0, 500),
        contentCreatedAt: content.createdAt,
        status: FlagStatus.PENDING,
        isUrgent: this.isUrgentFlag(dto.reason),
        reportCount: 1,
      });

      const savedFlag = await this.flagRepository.save(flag);

      // Marquer le contenu comme signalé
      if (dto.targetType === ContentType.POST) {
        await this.postRepository.update(dto.targetId, {
          isFlagged: true,
          flagReason: dto.reason,
          flaggedById: user.id,
          flaggedAt: new Date(),
        });
      } else {
        await this.commentRepository.update(dto.targetId, {
          isFlagged: true,
          flagReason: dto.reason,
          flaggedById: user.id,
          flaggedAt: new Date(),
        });
      }

      // Notifier les modérateurs
      await this.notifyModerators(savedFlag);

      return { 
        success: true, 
        message: 'Contenu signalé avec succès',
        flagId: savedFlag.id 
      };
    } catch (error) {
      this.logger.error(`💥 Error flagging content: ${error.message}`, error.stack);
      throw error;
    }
  }

  // =============== MENTIONS ===============

  async searchUsersForMentions(user: IUser, searchDto: MentionSearchDto) {
    try {
      const queryBuilder = this.userRepository
        .createQueryBuilder('user')
        .where('user.isActive = true')
        .andWhere('user.id != :currentUserId', { currentUserId: user.id })
        .andWhere('LOWER(user.fullName) LIKE LOWER(:query)', { 
          query: `%${searchDto.query}%` 
        });

      // Filtre par département si spécifié
      if (searchDto.department) {
        queryBuilder.andWhere('user.department = :department', { 
          department: searchDto.department 
        });
      }

      const users = await queryBuilder
        .orderBy('user.fullName', 'ASC')
        .take(searchDto.limit || 10)
        .getMany();

      return {
        users: users.map(u => ({
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          department: u.department,
          profilePicture: u.profilePicture,
          isActive: u.isActive,
        })),
        total: users.length,
        query: searchDto.query,
      };
    } catch (error) {
      this.logger.error(`💥 Error searching users for mentions: ${error.message}`, error.stack);
      throw error;
    }
  }

  async validateMentions(user: IUser, content: string, mentions: string[]) {
    try {
      if (!mentions || mentions.length === 0) {
        return { validMentions: [], invalidMentions: [] };
      }

      // Rechercher les utilisateurs par nom complet
      const users = await this.userRepository
        .createQueryBuilder('user')
        .where('user.isActive = true')
        .andWhere('user.fullName IN (:...mentions)', { mentions })
        .getMany();

      const validMentions = users.map(u => u.id);
      const foundNames = users.map(u => u.fullName);
      const invalidMentions = mentions.filter(mention => !foundNames.includes(mention));

      return { validMentions, invalidMentions };
    } catch (error) {
      this.logger.error(`💥 Error validating mentions: ${error.message}`, error.stack);
      return { validMentions: [], invalidMentions: mentions };
    }
  }

  async resolveMentions(user: IUser, mentions: string[]) {
    try {
      if (!mentions || mentions.length === 0) {
        return { users: [] };
      }

      const users = await this.userRepository.find({
        where: { 
          id: In(mentions),
          isActive: true 
        },
      });

      return {
        users: users.map(u => ({
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          department: u.department,
          profilePicture: u.profilePicture,
        })),
      };
    } catch (error) {
      this.logger.error(`💥 Error resolving mentions: ${error.message}`, error.stack);
      return { users: [] };
    }
  }

  // =============== HELPER METHODS ===============

  private async resolveMentionsToUserIds(mentions: string[]): Promise<string[]> {
    if (!mentions || mentions.length === 0) return [];

    try {
      // Filtrer les mentions valides (noms complets, pas des IDs partiels)
      const validMentions = mentions.filter(mention => {
        // Ignorer les mentions qui ressemblent à des IDs partiels ou invalides
        if (!mention || mention.length < 2) return false;
        if (/^[0-9a-f-]{8,}$/i.test(mention)) return false; // Éviter les IDs partiels
        if (mention.length < 3 || mention.length > 100) return false;
        return true;
      });

      if (validMentions.length === 0) return [];

      // Rechercher les utilisateurs par nom complet avec une requête sécurisée
      const users = await this.userRepository
        .createQueryBuilder('user')
        .where('user.isActive = true')
        .andWhere('user.fullName IN (:...mentions)', { mentions: validMentions })
        .getMany();

      this.logger.log(`🔍 Resolved ${users.length}/${validMentions.length} mentions to user IDs`);
      return users.map(u => u.id);
    } catch (error) {
      this.logger.error(`💥 Error resolving mentions to user IDs: ${error.message}`);
      return [];
    }
  }

  private async notifyMentionedUsers(post: Post, mentionedUserIds: string[]) {
    try {
      // Filtrer les IDs valides
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const validUserIds = mentionedUserIds.filter(id => uuidRegex.test(id));
      
      if (validUserIds.length === 0) {
        this.logger.warn(`⚠️ No valid user IDs found in mentions: ${mentionedUserIds.join(', ')}`);
        return;
      }

      const mentionedUsers = await this.userRepository.find({
        where: { id: In(validUserIds) },
      });

      for (const mentionedUser of mentionedUsers) {
        if (mentionedUser.id !== post.authorId) {
          await this.notificationsService.notifyPostMention(
            post,
            mentionedUser.id,
            mentionedUser.fullName,
            post.authorName
          );
        }
      }
      
      this.logger.log(`✅ Notified ${mentionedUsers.length} mentioned users`);
    } catch (error) {
      this.logger.error(`💥 Error notifying mentioned users: ${error.message}`);
    }
  }

  private async notifyMentionedUsersInComment(comment: Comment, mentionedUserIds: string[]) {
    try {
      // Filtrer les IDs valides
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const validUserIds = mentionedUserIds.filter(id => uuidRegex.test(id));
      
      if (validUserIds.length === 0) {
        this.logger.warn(`⚠️ No valid user IDs found in comment mentions: ${mentionedUserIds.join(', ')}`);
        return;
      }

      const mentionedUsers = await this.userRepository.find({
        where: { id: In(validUserIds) },
      });

      for (const mentionedUser of mentionedUsers) {
        if (mentionedUser.id !== comment.authorId) {
          await this.notificationsService.notifyPostMention(
            { id: comment.postId },
            mentionedUser.id,
            mentionedUser.fullName,
            comment.authorName
          );
        }
      }
      
      this.logger.log(`✅ Notified ${mentionedUsers.length} mentioned users in comment`);
    } catch (error) {
      this.logger.error(`💥 Error notifying mentioned users in comment: ${error.message}`);
    }
  }

  private async notifyModerators(flag: Flag) {
    try {
      // Récupérer les modérateurs (Admin et AgentEY du département)
      const moderators = await this.userRepository
        .createQueryBuilder('user')
        .where('user.isActive = true')
        .andWhere(
          '(user.roles LIKE :admin OR (user.roles LIKE :agent AND user.department = :department))',
          {
            admin: '%Admin%',
            agent: '%AgentEY%',
            department: flag.contentAuthorDepartment,
          }
        )
        .getMany();

      if (moderators.length > 0) {
        await this.notificationsService.notifyContentFlagged(flag, moderators.map(m => m.id));
      }
    } catch (error) {
      this.logger.error(`💥 Error notifying moderators: ${error.message}`);
    }
  }

  private async recordPostView(postId: string, user: IUser) {
    try {
      const existingView = await this.postViewRepository.findOne({
        where: { postId, userId: user.id },
      });

      if (!existingView) {
        const view = this.postViewRepository.create({
          postId,
          userId: user.id,
          userName: user.fullName,
          userDepartment: user.department.toString(),
        });

        await this.postViewRepository.save(view);
        await this.postRepository.increment({ id: postId }, 'viewsCount', 1);
      }
    } catch (error) {
      this.logger.error(`💥 Error recording post view: ${error.message}`);
    }
  }

  private canUserViewPost(post: Post, user: IUser): boolean {
    if (post.isPublic) return true;
    if (post.departmentOnly && post.authorDepartment === user.department) return true;
    if (post.authorId === user.id) return true;
    return false;
  }

  private isUrgentFlag(reason: string): boolean {
    const urgentReasons = ['harassment', 'hate_speech', 'violence', 'illegal_content'];
    return urgentReasons.some(urgent => reason.toLowerCase().includes(urgent));
  }

  // =============== MAPPING METHODS ===============

  private async mapToPostDto(post: Post, user: IUser): Promise<PostDto> {
    // Récupérer les réactions de l'utilisateur
    const userReaction = await this.reactionRepository.findOne({
      where: {
        userId: user.id,
        targetId: post.id,
        targetType: ContentType.POST,
      },
    });

    // Récupérer le post original si c'est un partage
    let originalPost: PostDto | undefined;
    if (post.originalPostId) {
      const original = await this.postRepository.findOne({
        where: { id: post.originalPostId, deletedAt: null },
      });
      if (original) {
        originalPost = await this.mapToPostDto(original, user);
      }
    }

    // Résoudre les mentions (IDs → noms)
    const resolvedMentions = await this.resolveMentionIdsToNames(post.mentions || []);

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
      mentions: resolvedMentions, // Retourner les noms pour l'affichage
      isPublic: post.isPublic,
      departmentOnly: post.departmentOnly,
      allowComments: post.allowComments,
      allowShares: post.allowShares,
      isPinned: post.isPinned,
      isEdited: post.isEdited,
      originalPostId: post.originalPostId,
      originalAuthorName: post.originalAuthorName,
      originalPost,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      sharesCount: post.sharesCount,
      viewsCount: post.viewsCount,
      isFlagged: post.isFlagged,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      isLiked: !!userReaction,
      userReaction: userReaction?.type,
      isFollowingAuthor: false, // TODO: Implémenter
      canEdit: post.authorId === user.id,
      canDelete: post.authorId === user.id || user.roles.includes(Role.ADMIN) || user.roles.includes(Role.AGENT_EY),
      canFlag: post.authorId !== user.id,
    };
  }

  private async mapToCommentDto(comment: Comment, user: IUser): Promise<CommentDto> {
    const userReaction = await this.reactionRepository.findOne({
      where: {
        userId: user.id,
        targetId: comment.id,
        targetType: ContentType.COMMENT,
      },
    });

    // Résoudre les mentions
    const resolvedMentions = await this.resolveMentionIdsToNames(comment.mentions || []);

    return {
      id: comment.id,
      content: comment.content,
      authorId: comment.authorId,
      authorName: comment.authorName,
      authorProfilePicture: comment.authorProfilePicture,
      authorDepartment: comment.authorDepartment,
      postId: comment.postId,
      parentCommentId: comment.parentCommentId,
      mentions: resolvedMentions,
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
      canDelete: comment.authorId === user.id || user.roles.includes(Role.ADMIN) || user.roles.includes(Role.AGENT_EY),
      canFlag: comment.authorId !== user.id,
    };
  }

  private mapToReactionDto(reaction: Reaction): ReactionDto {
    return {
      id: reaction.id,
      type: reaction.type,
      userId: reaction.userId,
      userName: reaction.userName,
      userProfilePicture: reaction.userProfilePicture,
      userDepartment: reaction.userDepartment,
      targetId: reaction.targetId,
      targetType: reaction.targetType,
      createdAt: reaction.createdAt,
    };
  }

  private async resolveMentionIdsToNames(mentionIds: string[]): Promise<string[]> {
    if (!mentionIds || mentionIds.length === 0) return [];

    try {
      // Filtrer les IDs valides (format UUID)
      const validUUIDs = mentionIds.filter(id => {
        if (!id || typeof id !== 'string') return false;
        // Vérifier le format UUID
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return uuidRegex.test(id);
      });

      if (validUUIDs.length === 0) {
        this.logger.warn(`⚠️ No valid UUIDs found in mentions: ${mentionIds.join(', ')}`);
        return [];
      }

      const users = await this.userRepository.find({
        where: { id: In(validUUIDs) },
        select: ['id', 'fullName'],
      });

      this.logger.log(`🔍 Resolved ${users.length}/${validUUIDs.length} mention IDs to names`);
      return users.map(u => u.fullName);
    } catch (error) {
      this.logger.error(`💥 Error resolving mention IDs to names: ${error.message}`);
      return [];
    }
  }
}