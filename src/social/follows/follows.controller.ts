import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  ParseUUIDPipe,
  HttpStatus,
  HttpCode,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserId } from '../../shared/decorators/user.decorator';
import { FollowsService } from './follows.service';
import { CreateFollowDto, FollowDto, FollowCountsDto } from './dto/follow.dto';
import { IUser } from '../../shared/interfaces/user.interface';

@Controller('social/follows')
@UseGuards(JwtAuthGuard)
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  /**
   * Suivre un utilisateur
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async followUser(
    @CurrentUser() user: IUser,
    @Body(new ValidationPipe()) dto: CreateFollowDto,
  ): Promise<FollowDto> {
    console.log('FollowsController.followUser - user:', user.id);
    console.log('FollowsController.followUser - dto:', dto);

    return this.followsService.followUser(user, dto);
  }

  /**
   * Ne plus suivre un utilisateur
   */
  @Delete(':followedId')
  @HttpCode(HttpStatus.OK)
  async unfollowUser(
    @CurrentUserId() followerId: string,
    @Param('followedId', new ParseUUIDPipe()) followedId: string,
  ): Promise<{ success: boolean; message: string }> {
    console.log('FollowsController.unfollowUser:', { followerId, followedId });

    await this.followsService.unfollowUser(followerId, followedId);
    return { 
      success: true, 
      message: 'Utilisateur non suivi avec succès' 
    };
  }

  /**
   * Récupérer les followers d'un utilisateur
   */
  @Get('followers/:userId')
  async getFollowers(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
  ) {
    console.log('FollowsController.getFollowers:', { userId, page, limit });

    return this.followsService.getFollowers(userId, page, limit);
  }

  /**
   * Récupérer les utilisateurs suivis
   */
  @Get('following/:userId')
  async getFollowing(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
  ) {
    console.log('FollowsController.getFollowing:', { userId, page, limit });

    return this.followsService.getFollowing(userId, page, limit);
  }

  /**
   * Récupérer les compteurs de follows
   */
  @Get('counts/:userId')
  async getFollowCounts(
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<FollowCountsDto> {
    console.log('FollowsController.getFollowCounts:', userId);

    return this.followsService.getFollowCounts(userId);
  }

  /**
   * Vérifier si l'utilisateur suit un autre
   */
  @Get('is-following/:followedId')
  async isFollowing(
    @CurrentUserId() followerId: string,
    @Param('followedId', new ParseUUIDPipe()) followedId: string,
  ): Promise<{ isFollowing: boolean }> {
    console.log('FollowsController.isFollowing:', { followerId, followedId });

    const isFollowing = await this.followsService.isFollowing(followerId, followedId);
    return { isFollowing };
  }

  /**
   * Récupérer les suggestions de suivi
   */
  @Get('suggestions')
  async getFollowSuggestions(
    @CurrentUserId() currentUserId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10,
  ): Promise<FollowDto[]> {
    console.log('FollowsController.getFollowSuggestions:', { currentUserId, limit });

    return this.followsService.getFollowSuggestions(currentUserId, limit);
  }

  /**
   * Récupérer un utilisateur par son ID
   */
  @Get('user/:userId')
  async getUserById(
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    console.log('FollowsController.getUserById:', userId);

    const user = await this.followsService.getUserById(userId);
    
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      profilePicture: user.profilePicture,
      department: user.department,
      fonction: user.fonction,
      sector: user.sector,
      phoneNumber: user.phoneNumber,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /**
   * Récupérer les connexions mutuelles
   */
  @Get('mutual/:userId')
  async getMutualConnections(
    @CurrentUserId() currentUserId: string,
    @Param('userId', new ParseUUIDPipe()) targetUserId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10,
  ) {
    console.log('FollowsController.getMutualConnections:', { currentUserId, targetUserId, limit });

    return this.followsService.getMutualConnections(currentUserId, targetUserId, limit);
  }
}