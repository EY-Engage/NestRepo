import { Department } from "src/shared/enums/department.enum";
import { PostDto } from "../posts/dto/post.dto";

export class UserProfileDto {
  id: string;
  fullName: string;
  email: string;
  profilePicture?: string;
  department: Department;
  fonction: string;
  sector: string;
  
  // Stats du profil
  postsCount: number;
  followersCount: number;
  followingCount: number;
  
  // Données relatives à l'utilisateur connecté
  isFollowing?: boolean;
  isFollower?: boolean;
  mutualConnections?: number;
  canFollow?: boolean;
  
  // Posts récents
  recentPosts?: PostDto[];
}
