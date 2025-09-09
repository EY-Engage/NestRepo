import { Controller, UseGuards, Get, Query, ParseIntPipe, BadRequestException, Post, Body, Param, ParseUUIDPipe, UseInterceptors, UploadedFiles, NotFoundException, ForbiddenException, InternalServerErrorException, Delete, Put } from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { extname } from "path";
import { Roles } from "src/shared/decorators/roles.decorator";
import { CurrentUser } from "src/shared/decorators/user.decorator";
import { ReactionType } from "src/shared/enums/reaction-type.enum";
import { Role } from "src/shared/enums/role.enum";
import { JwtAuthGuard } from "src/shared/guards/jwt-auth.guard";
import { RolesGuard } from "src/shared/guards/roles.guard";
import { IUser } from "src/shared/interfaces/user.interface";
import { FeedQueryDto } from "src/social/dto/feed.dto";
import { FlagContentDto } from "src/social/dto/moderation.dto";
import { SearchQueryDto } from "src/social/dto/search.dto";
import { CreateCommentDto, UpdateCommentDto } from "src/social/posts/dto/create-comment.dto";
import { CreatePostDto, SharePostDto, UpdatePostDto } from "src/social/posts/dto/create-post.dto";
import { CreateReactionDto } from "src/social/posts/dto/reaction.dto";
import { PostsService } from "src/social/posts/posts.service";
import { v4 as uuidv4 } from 'uuid';

@Controller('social/posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  // =============== ROUTES SPÉCIFIQUES EN PREMIER ===============

  // ✅ NOUVEAU: Endpoint pour rechercher les utilisateurs à mentionner
  @Get('mentions/search')
  async searchUsersForMentions(
    @CurrentUser() user: IUser,
    @Query('q') query: string,
    @Query('department') department?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10,
  ) {
    if (!query || query.trim().length < 1) {
      throw new BadRequestException('La requête de recherche doit contenir au moins 1 caractère');
    }

    if (limit > 50) {
      limit = 50; // Limiter à 50 résultats maximum
    }

    return this.postsService.searchUsersForMentions(user, {
      query: query.trim(),
      department,
      limit,
    });
  }

  // ✅ NOUVEAU: Endpoint pour valider les mentions dans un texte
  @Post('mentions/validate')
  async validateMentions(
    @CurrentUser() user: IUser,
    @Body('content') content: string,
    @Body('mentions') mentions: string[],
  ) {
    if (!content) {
      throw new BadRequestException('Le contenu est requis pour valider les mentions');
    }

    return this.postsService.validateMentions(user, content, mentions || []);
  }

  // ✅ NOUVEAU: Endpoint pour obtenir les détails des utilisateurs mentionnés
  @Post('mentions/resolve')
  async resolveMentions(
    @CurrentUser() user: IUser,
    @Body('mentions') mentions: string[],
  ) {
    if (!mentions || !Array.isArray(mentions)) {
      throw new BadRequestException('La liste des mentions est requise');
    }

    return this.postsService.resolveMentions(user, mentions);
  }

  @Get('feed')
  async getFeed(
    @CurrentUser() user: IUser,
    @Query() query: FeedQueryDto,
  ) {
    return this.postsService.getFeed(user, query);
  }

  @Get('trending')
  async getTrending(@CurrentUser() user: IUser) {
    return this.postsService.getTrending(user);
  }

  @Get('search')
  async searchPosts(
    @CurrentUser() user: IUser,
    @Query() query: SearchQueryDto,
  ) {
    return this.postsService.searchPosts(user, query);
  }

  @Get('advanced-search')
  async advancedSearch(
    @CurrentUser() user: IUser,
    @Query('query') query?: string,
    @Query('author') author?: string,
    @Query('department') department?: string,
    @Query('tags') tags?: string | string[],
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('hasImages') hasImages?: boolean,
    @Query('hasFiles') hasFiles?: boolean,
    @Query('sortBy') sortBy?: 'recent' | 'popular' | 'relevance',
    @Query('page', ParseIntPipe) page: number = 1,
    @Query('limit', ParseIntPipe) limit: number = 10,
  ) {
    const options = {
      query,
      author,
      department,
      tags: Array.isArray(tags) ? tags : (tags ? [tags] : undefined),
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      hasImages,
      hasFiles,
      sortBy,
      page,
      limit,
    };

    return this.postsService.advancedSearch(user, options);
  }

  // ROUTES BOOKMARKS - AVANT LES ROUTES AVEC PARAMÈTRES
  @Get('bookmarks')
  async getBookmarkedPosts(
    @CurrentUser() user: IUser,
    @Query('page', ParseIntPipe) page: number = 1,
    @Query('limit', ParseIntPipe) limit: number = 10,
  ) {
    return this.postsService.getBookmarkedPosts(user, page, limit);
  }

  // ROUTES FLAGGED CONTENT
  @Get('flagged')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.AGENT_EY)
  async getFlaggedContent(
    @CurrentUser() user: IUser,
    @Query('page', ParseIntPipe) page: number = 1,
    @Query('limit', ParseIntPipe) limit: number = 20,
  ) {
    return { success: true, data: [], message: 'Fonctionnalité en cours de développement' };
  }

  // ROUTES AVEC PARAMÈTRES SPÉCIFIQUES
  @Get('user/:userId/posts')
  async getUserPosts(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: IUser,
    @Query('page', ParseIntPipe) page: number = 1,
    @Query('limit', ParseIntPipe) limit: number = 10,
  ) {
    const feedQuery: FeedQueryDto = {
      page,
      limit,
      sortBy: 'recent',
    };
    
    return this.postsService.advancedSearch(user, {
      author: userId,
      page,
      limit,
      sortBy: 'recent'
    });
  }

  @Get('department/:department/posts')
  async getDepartmentPosts(
    @Param('department') department: string,
    @CurrentUser() user: IUser,
    @Query('page', ParseIntPipe) page: number = 1,
    @Query('limit', ParseIntPipe) limit: number = 10,
  ) {
    const feedQuery: FeedQueryDto = {
      page,
      limit,
      department,
      departmentOnly: true,
      sortBy: 'recent',
    };
    
    return this.postsService.getFeed(user, feedQuery);
  }

  @Get('comments/:id/replies')
  async getCommentReplies(
    @Param('id', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: IUser,
    @Query('page', ParseIntPipe) page: number = 1,
    @Query('limit', ParseIntPipe) limit: number = 10,
  ) {
    return this.postsService.getCommentReplies(commentId, user, page, limit);
  }

  @Get('comments/:id/reactions')
  async getCommentReactions(
    @Param('id', ParseUUIDPipe) commentId: string,
    @Query('type') reactionType?: ReactionType,
  ) {
    return this.postsService.getCommentReactions(commentId, reactionType);
  }

  // ROUTE GÉNÉRIQUE AVEC ID - DOIT ÊTRE EN DERNIER
  @Get(':id')
  async getPostById(
    @Param('id', ParseUUIDPipe) postId: string,
    @CurrentUser() user: IUser,
  ) {
    return this.postsService.getPostById(postId, user);
  }

  @Get(':id/comments')
  async getPostComments(
    @Param('id', ParseUUIDPipe) postId: string,
    @CurrentUser() user: IUser,
    @Query('page', ParseIntPipe) page: number = 1,
    @Query('limit', ParseIntPipe) limit: number = 20,
  ) {
    return this.postsService.getPostComments(postId, user, page, limit);
  }

  @Get(':id/reactions')
  async getPostReactions(
    @Param('id', ParseUUIDPipe) postId: string,
    @Query('type') reactionType?: ReactionType,
  ) {
    return this.postsService.getPostReactions(postId, reactionType);
  }

  @Get(':id/bookmark/status')
  async getBookmarkStatus(
    @Param('id', ParseUUIDPipe) postId: string,
    @CurrentUser() user: IUser,
  ) {
    return this.postsService.isPostBookmarked(user, postId);
  }

  @Get(':id/stats')
  async getPostStats(
    @Param('id', ParseUUIDPipe) postId: string,
    @CurrentUser() user: IUser,
  ) {
    const post = await this.postsService.getPostById(postId, user);
    const reactions = await this.postsService.getPostReactions(postId);
    
    const totalEngagement = reactions.length + post.commentsCount + post.sharesCount;
    const engagementRate = post.viewsCount > 0 ? (totalEngagement / post.viewsCount) * 100 : 0;
    
    return {
      views: post.viewsCount,
      reactions: reactions.length,
      comments: post.commentsCount,
      shares: post.sharesCount,
      engagementRate: Math.round(engagementRate * 100) / 100
    };
  }

  // =============== ROUTES POST ===============

  @Post()
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'images', maxCount: 5 },
    { name: 'files', maxCount: 3 },
  ], {
    storage: diskStorage({
      destination: './uploads',
      filename: (req, file, cb) => {
        const randomName = uuidv4();
        cb(null, `${randomName}${extname(file.originalname)}`);
      },
    }),
    fileFilter: (req, file, cb) => {
      if (file.fieldname === 'images') {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
          return cb(new Error('Seules les images sont autorisées'), false);
        }
      }
      
      if (file.fieldname === 'files') {
        const allowedFileTypes = [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/plain'
        ];
        
        if (!allowedFileTypes.includes(file.mimetype)) {
          return cb(new Error(`Type de fichier non autorisé: ${file.mimetype}`), false);
        }
      }
      
      cb(null, true);
    },
    limits: {
      fileSize: 25 * 1024 * 1024, // 25MB
    },
  }))
  async createPost(
    @CurrentUser() user: IUser,
    @Body() dto: CreatePostDto,
    @UploadedFiles() files: { images?: Express.Multer.File[], files?: Express.Multer.File[] },
  ) {
    if (files?.images) {
      dto.images = files.images.map(file => file.filename);
    }
    if (files?.files) {
      dto.files = files.files.map(file => file.filename);
    }

    // ✅ CORRECTION: Validation et traitement des mentions avant création
    if (dto.mentions && dto.mentions.length > 0) {
      try {
        const validatedMentions = await this.postsService.validateMentions(user, dto.content, dto.mentions);
        dto.mentions = validatedMentions.validMentions;
        
        if (validatedMentions.invalidMentions.length > 0) {
          console.warn('Some mentions were invalid:', validatedMentions.invalidMentions);
        }
      } catch (mentionError) {
        console.error('Error validating mentions:', mentionError);
        // Ne pas faire échouer la création du post pour des erreurs de mentions
      }
    }

    return this.postsService.createPost(user, dto);
  }

  @Post('share')
  async sharePost(
    @CurrentUser() user: IUser,
    @Body() dto: SharePostDto,
  ) {
    // ✅ NOUVEAU: Validation des mentions dans les commentaires de partage
    if (dto.mentions && dto.mentions.length > 0) {
      try {
        const validatedMentions = await this.postsService.validateMentions(user, dto.comment || '', dto.mentions);
        dto.mentions = validatedMentions.validMentions;
      } catch (mentionError) {
        console.error('Error validating share mentions:', mentionError);
      }
    }

    return this.postsService.sharePost(user, dto);
  }

  @Post('comments')
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'attachments', maxCount: 3 },
  ], {
    storage: diskStorage({
      destination: './uploads',
      filename: (req, file, cb) => {
        const randomName = uuidv4();
        cb(null, `${randomName}${extname(file.originalname)}`);
      },
    }),
    fileFilter: (req, file, cb) => {
      const allowedTypes = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
        'application/pdf', 'text/plain'
      ];
      
      if (!allowedTypes.includes(file.mimetype)) {
        return cb(new Error('Type de fichier non autorisé pour les commentaires'), false);
      }
      
      cb(null, true);
    },
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB pour les commentaires
    },
  }))
  async createComment(
    @CurrentUser() user: IUser,
    @Body() dto: CreateCommentDto,
    @UploadedFiles() files: { attachments?: Express.Multer.File[] },
  ) {
    if (files?.attachments) {
      dto.attachments = files.attachments.map(file => file.filename);
    }

    // ✅ NOUVEAU: Validation des mentions dans les commentaires
    if (dto.mentions && dto.mentions.length > 0) {
      try {
        const validatedMentions = await this.postsService.validateMentions(user, dto.content, dto.mentions);
        dto.mentions = validatedMentions.validMentions;
      } catch (mentionError) {
        console.error('Error validating comment mentions:', mentionError);
      }
    }

    return this.postsService.createComment(user, dto);
  }

  @Post('reactions')
  async toggleReaction(
    @CurrentUser() user: IUser,
    @Body() dto: CreateReactionDto,
  ) {
    return this.postsService.toggleReaction(user, dto);
  }

  @Post('flag')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.AGENT_EY, Role.EMPLOYEE_EY)
  async flagContent(
    @CurrentUser() user: IUser,
    @Body() dto: FlagContentDto,
  ) {
    try {
      return await this.postsService.flagContent(user, dto);
    } catch (error) {
      if (error instanceof BadRequestException ||
          error instanceof NotFoundException ||
          error instanceof ForbiddenException) {
        throw error;
      }
      
      console.error('Erreur inattendue lors du signalement:', error);
      throw new InternalServerErrorException('Erreur lors du signalement');
    }
  }

  @Post(':id/bookmark')
  async bookmarkPost(
    @Param('id', ParseUUIDPipe) postId: string,
    @CurrentUser() user: IUser,
  ) {
    return this.postsService.bookmarkPost(user, postId);
  }

  @Delete(':id/bookmark')
  async unbookmarkPost(
    @Param('id', ParseUUIDPipe) postId: string,
    @CurrentUser() user: IUser,
  ) {
    return this.postsService.unbookmarkPost(user, postId);
  }

  @Post(':id/share-external')
  async sharePostExternal(
    @Param('id', ParseUUIDPipe) postId: string,
    @CurrentUser() user: IUser,
  ) {
    const post = await this.postsService.getPostById(postId, user);
    
    const shareUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/EyEngage/social/posts/${postId}`;
    
    return {
      success: true,
      shareUrl,
      post: {
        title: `Publication de ${post.authorName}`,
        description: post.content.length > 100 ? post.content.substring(0, 100) + '...' : post.content,
        image: post.images && post.images.length > 0 ? post.images[0] : null,
      }
    };
  }

  // =============== ROUTES PUT ===============

  @Put(':id')
  async updatePost(
    @Param('id', ParseUUIDPipe) postId: string,
    @CurrentUser() user: IUser,
    @Body() dto: UpdatePostDto,
  ) {
    // ✅ NOUVEAU: Validation des mentions pour les mises à jour
    if (dto.mentions && dto.mentions.length > 0) {
      try {
        const validatedMentions = await this.postsService.validateMentions(user, dto.content || '', dto.mentions);
        dto.mentions = validatedMentions.validMentions;
      } catch (mentionError) {
        console.error('Error validating update mentions:', mentionError);
      }
    }

    return this.postsService.updatePost(postId, user, dto);
  }

  @Put('comments/:id')
  async updateComment(
    @Param('id', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: IUser,
    @Body() dto: UpdateCommentDto,
  ) {
    // ✅ NOUVEAU: Validation des mentions pour les mises à jour de commentaires
    if (dto.mentions && dto.mentions.length > 0) {
      try {
        const validatedMentions = await this.postsService.validateMentions(user, dto.content || '', dto.mentions);
        dto.mentions = validatedMentions.validMentions;
      } catch (mentionError) {
        console.error('Error validating comment update mentions:', mentionError);
      }
    }

    return this.postsService.updateComment(commentId, user, dto);
  }

  // =============== ROUTES DELETE ===============

  @Delete(':id')
  async deletePost(
    @Param('id', ParseUUIDPipe) postId: string,
    @CurrentUser() user: IUser,
  ) {
    await this.postsService.deletePost(postId, user);
    return { success: true, message: 'Post supprimé avec succès' };
  }

  @Delete('comments/:id')
  async deleteComment(
    @Param('id', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: IUser,
  ) {
    await this.postsService.deleteComment(commentId, user);
    return { success: true, message: 'Commentaire supprimé avec succès' };
  }
}