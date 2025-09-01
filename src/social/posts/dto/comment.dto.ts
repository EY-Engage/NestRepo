import { Department } from "src/shared/enums/department.enum";

export class CommentDto {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  authorProfilePicture?: string;
  authorDepartment: Department;
  postId: string;
  parentCommentId?: string;
  mentions?: string[];
  attachments?: string[];
  isEdited: boolean;
  likesCount: number;
  repliesCount: number;
  isFlagged: boolean;
  createdAt: Date;
  updatedAt: Date;

  // Données relatives à l'utilisateur connecté
  isLiked?: boolean;
  userReaction?: string;
  canEdit?: boolean;
  canDelete?: boolean;
  canFlag?: boolean;

  // Réponses (chargées séparément)
  replies?: CommentDto[];
}
