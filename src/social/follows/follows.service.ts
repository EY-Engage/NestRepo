import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Follow } from './entities/follow.entity';
import { User } from '../posts/entities/user.entity';
import { CreateFollowDto, FollowDto, FollowCountsDto } from './dto/follow.dto';
import { IUser } from '../../shared/interfaces/user.interface';

@Injectable()
export class FollowsService {
  constructor(
    @InjectRepository(Follow)
    private readonly followRepository: Repository<Follow>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Suivre un utilisateur
   */
  async followUser(currentUser: IUser, dto: CreateFollowDto): Promise<FollowDto> {
    console.log('FollowsService.followUser - début');
    console.log('CurrentUser:', currentUser.id);
    console.log('FollowedId:', dto.followedId);

    // Vérifier qu'on ne se suit pas soi-même
    if (currentUser.id === dto.followedId) {
      throw new BadRequestException('Vous ne pouvez pas vous suivre vous-même');
    }

    // Vérifier que l'utilisateur à suivre existe
    const userToFollow = await this.userRepository.findOne({
      where: { id: dto.followedId, isActive: true }
    });

    if (!userToFollow) {
      console.log('Utilisateur à suivre non trouvé:', dto.followedId);
      throw new NotFoundException('Utilisateur à suivre non trouvé');
    }

    // Vérifier que l'utilisateur actuel existe
    const followerUser = await this.userRepository.findOne({
      where: { id: currentUser.id, isActive: true }
    });

    if (!followerUser) {
      throw new NotFoundException('Utilisateur follower non trouvé');
    }

    // Vérifier si la relation existe déjà
    const existingFollow = await this.followRepository.findOne({
      where: {
        followerId: currentUser.id,
        followedId: dto.followedId,
        isActive: true
      }
    });

    if (existingFollow) {
      throw new ConflictException('Vous suivez déjà cet utilisateur');
    }

    // Créer la relation de suivi
    const follow = this.followRepository.create({
      followerId: currentUser.id,
      followedId: dto.followedId,
      isActive: true,
    });

    const savedFollow = await this.followRepository.save(follow);

    // Retourner le DTO complet
    return {
      id: savedFollow.id,
      followerId: currentUser.id,
      followerName: followerUser.fullName,
      followerProfilePicture: followerUser.profilePicture,
      followerDepartment: followerUser.department,
      followedId: dto.followedId,
      followedName: userToFollow.fullName,
      followedProfilePicture: userToFollow.profilePicture,
      followedDepartment: userToFollow.department,
      isActive: true,
      createdAt: savedFollow.createdAt,
    };
  }

  /**
   * Ne plus suivre un utilisateur
   */
  async unfollowUser(followerId: string, followedId: string): Promise<void> {
    console.log('FollowsService.unfollowUser - début');
    console.log('FollowerId:', followerId);
    console.log('FollowedId:', followedId);

    // Vérifier qu'on ne se désuit pas soi-même
    if (followerId === followedId) {
      throw new BadRequestException('Action invalide');
    }

    // Chercher la relation active
    const follow = await this.followRepository.findOne({
      where: {
        followerId,
        followedId,
        isActive: true
      }
    });

    if (!follow) {
      console.log('Relation de suivi non trouvée, mais on continue...');
      // Ne pas lever d'erreur, on considère que l'utilisateur n'était déjà plus suivi
      return;
    }

    // Marquer comme inactif au lieu de supprimer
    follow.isActive = false;
    follow.unfollowedAt = new Date();
    
    await this.followRepository.save(follow);
    console.log('Utilisateur non suivi avec succès');
  }

  /**
   * Obtenir les followers d'un utilisateur
   */
  async getFollowers(userId: string, page: number = 1, limit: number = 20) {
    const offset = (page - 1) * limit;

    const [follows, total] = await this.followRepository.findAndCount({
      where: {
        followedId: userId,
        isActive: true
      },
      relations: ['follower'],
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });

    const followers: FollowDto[] = follows.map(follow => ({
      id: follow.id,
      followerId: follow.followerId,
      followerName: follow.follower.fullName,
      followerProfilePicture: follow.follower.profilePicture,
      followerDepartment: follow.follower.department,
      followedId: follow.followedId,
      followedName: '', // Pas nécessaire dans ce context
      followedProfilePicture: undefined,
      followedDepartment: follow.follower.department, // Fallback
      isActive: follow.isActive,
      createdAt: follow.createdAt,
      unfollowedAt: follow.unfollowedAt,
    }));

    return {
      followers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Obtenir les utilisateurs suivis
   */
  async getFollowing(userId: string, page: number = 1, limit: number = 20) {
    const offset = (page - 1) * limit;

    const [follows, total] = await this.followRepository.findAndCount({
      where: {
        followerId: userId,
        isActive: true
      },
      relations: ['followed'],
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });

    const following: FollowDto[] = follows.map(follow => ({
      id: follow.id,
      followerId: follow.followerId,
      followerName: '', // Pas nécessaire dans ce context
      followerProfilePicture: undefined,
      followerDepartment: follow.followed.department, // Fallback
      followedId: follow.followedId,
      followedName: follow.followed.fullName,
      followedProfilePicture: follow.followed.profilePicture,
      followedDepartment: follow.followed.department,
      isActive: follow.isActive,
      createdAt: follow.createdAt,
      unfollowedAt: follow.unfollowedAt,
    }));

    return {
      following,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Obtenir les compteurs de suivi
   */
  async getFollowCounts(userId: string): Promise<FollowCountsDto> {
    const [followersCount, followingCount] = await Promise.all([
      this.followRepository.count({
        where: { followedId: userId, isActive: true }
      }),
      this.followRepository.count({
        where: { followerId: userId, isActive: true }
      }),
    ]);

    return { followersCount, followingCount };
  }

  /**
   * Vérifier si un utilisateur en suit un autre
   */
  async isFollowing(followerId: string, followedId: string): Promise<boolean> {
    if (followerId === followedId) return false;

    const follow = await this.followRepository.findOne({
      where: {
        followerId,
        followedId,
        isActive: true
      }
    });

    return !!follow;
  }

  /**
   * Obtenir les suggestions de suivi
   * Les 5 meilleurs utilisateurs avec le plus d'abonnés, puis par ordre alphabétique
   */
  async getFollowSuggestions(currentUserId: string, limit: number = 10): Promise<FollowDto[]> {
    // Utilisateurs que l'utilisateur actuel ne suit pas déjà
    const alreadyFollowing = await this.followRepository.find({
      where: { followerId: currentUserId, isActive: true },
      select: ['followedId']
    });
    
    const excludeIds = [currentUserId, ...alreadyFollowing.map(f => f.followedId)];

    // Requête pour obtenir les utilisateurs avec leurs compteurs de followers
    const query = `
      SELECT 
        u.id,
        u."fullName",
        u."profilePicture", 
        u.department,
        u.fonction,
        u.sector,
        COUNT(f.id) as followers_count
      FROM users u
      LEFT JOIN follows f ON u.id = f."followedId" AND f."isActive" = true
      WHERE u."isActive" = true 
        AND u.id NOT IN (${excludeIds.map((_, i) => `$${i + 1}`).join(', ')})
      GROUP BY u.id, u."fullName", u."profilePicture", u.department, u.fonction, u.sector
      ORDER BY followers_count DESC, u."fullName" ASC
      LIMIT $${excludeIds.length + 1}
    `;

    const users = await this.userRepository.query(query, [...excludeIds, limit]);

    return users.map(user => ({
      id: user.id,
      followerId: currentUserId,
      followerName: '',
      followerProfilePicture: undefined,
      followerDepartment: user.department,
      followedId: user.id,
      followedName: user.fullName,
      followedProfilePicture: user.profilePicture,
      followedDepartment: user.department,
      isActive: false, // Suggestion, pas encore suivi
      createdAt: new Date(),
    }));
  }

  /**
   * Obtenir un utilisateur par son ID
   */
  async getUserById(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: userId, isActive: true }
    });

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    return user;
  }

  /**
   * Obtenir les connexions mutuelles
   */
  async getMutualConnections(currentUserId: string, targetUserId: string, limit: number = 10) {
    const query = `
      SELECT DISTINCT
        u.id,
        u."fullName",
        u."profilePicture",
        u.department,
        f1."createdAt" as following_since
      FROM users u
      INNER JOIN follows f1 ON u.id = f1."followedId" 
      INNER JOIN follows f2 ON u.id = f2."followedId"
      WHERE f1."followerId" = $1 
        AND f2."followerId" = $2 
        AND f1."isActive" = true 
        AND f2."isActive" = true
        AND u."isActive" = true
      ORDER BY u."fullName" ASC
      LIMIT $3
    `;

    const connections = await this.userRepository.query(query, [currentUserId, targetUserId, limit]);
    
    return connections.map(conn => ({
      id: conn.id,
      name: conn.fullName,
      profilePicture: conn.profilePicture,
      department: conn.department,
      followingSince: conn.following_since
    }));
  }
}