import { Department } from "src/shared/enums/department.enum";

export class PostDto {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  authorProfilePicture?: string;
  authorDepartment: Department;
  images?: string[];
  files?: string[];
  tags?: string[];
  mentions?: string[];
  isPublic: boolean;
  departmentOnly: boolean;
  allowComments: boolean;
  allowShares: boolean;
  isPinned: boolean;
  isEdited: boolean;
  originalPostId?: string;
  originalAuthorName?: string;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  viewsCount: number;
  isFlagged: boolean;
  createdAt: Date;
  updatedAt: Date;
  
  // Données relatives à l'utilisateur connecté
  isLiked?: boolean;
  userReaction?: string;
  isFollowingAuthor?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canFlag?: boolean;

  // Post original (pour les partages)
  originalPost?: PostDto;
}
