import {
  Controller,
  Get,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../shared/guards/roles.guard';
import { Roles } from '../shared/decorators/roles.decorator';
import { CurrentUser } from '../shared/decorators/user.decorator';
import { PostsService } from './posts/posts.service';
import { FollowsService } from './follows/follows.service';
import { IUser } from '../shared/interfaces/user.interface';
import { Department } from 'src/shared/enums/department.enum';
import { Role } from 'src/shared/enums/role.enum';
import { SearchQueryDto } from './dto/search.dto';

@Controller('social')
@UseGuards(JwtAuthGuard)
export class SocialController {
  constructor(
    private readonly postsService: PostsService,
    private readonly followsService: FollowsService,
  ) {}

  @Get('search')
  async search(
    @CurrentUser() user: IUser,
    @Query() query: SearchQueryDto,
  ) {
    return this.postsService.searchPosts(user, query);
  }

  @Get('analytics')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.AGENT_EY)
  async getAnalytics(
    @CurrentUser() user: IUser,
    @Query('department') department?: Department,
  ) {
    // Filtrer par département pour AgentEY
    const departmentFilter = user.roles.includes(Role.AGENT_EY) && !user.roles.includes(Role.ADMIN)
      ? user.department
      : department;

    // Logique d'analytics à implémenter
    return {
      totalPosts: 0,
      totalComments: 0,
      totalReactions: 0,
      totalFollows: 0,
      // ... autres statistiques
    };
  }

  @Get('dashboard')
  async getDashboard(@CurrentUser() user: IUser) {
    // Tableau de bord personnalisé pour l'utilisateur
    return {
      recentPosts: [], // Posts récents du feed
      followSuggestions: [], // Suggestions de personnes à suivre
      trending: [], // Tendances
      notifications: [], // Notifications récentes
    };
  }
}