import { IsUUID, IsNotEmpty } from "class-validator";
import { Department } from "src/shared/enums/department.enum";

// DTO pour créer un follow
export class CreateFollowDto {
  @IsNotEmpty({ message: 'followedId est requis' })
  followedId: string;
}

// DTO de réponse pour un follow
export class FollowDto {
  id: string;
  followerId: string;
  followerName: string;
  followerProfilePicture?: string;
  followerDepartment: Department;
  followedId: string;
  followedName: string;
  followedProfilePicture?: string;
  followedDepartment: Department;
  isActive: boolean;
  createdAt: Date;
  unfollowedAt?: Date;
}

// DTO pour les compteurs de follow
export class FollowCountsDto {
  followersCount: number;
  followingCount: number;
}