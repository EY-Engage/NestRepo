import { ContentType } from "../enums/content-type.enum";
import { Department } from "../enums/department.enum";
import { ReactionType } from "../enums/reaction-type.enum";

export interface IPost {
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
  createdAt: Date;
  updatedAt?: Date;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  isEdited: boolean;
  originalPostId?: string; // For shares
}

export interface IReaction {
  id: string;
  type: ReactionType;
  userId: string;
  userName: string;
  userProfilePicture?: string;
  targetId: string;
  targetType: ContentType;
  createdAt: Date;
}

export interface IComment {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  authorProfilePicture?: string;
  postId: string;
  parentCommentId?: string;
  mentions?: string[];
  attachments?: string[];
  createdAt: Date;
  updatedAt?: Date;
  likesCount: number;
  repliesCount: number;
  isEdited: boolean;
}

export interface IFollow {
  id: string;
  followerId: string;
  followedId: string;
  createdAt: Date;
}
