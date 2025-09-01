import { Department } from "src/shared/enums/department.enum";
import { PostDto } from "../posts/dto/post.dto";

export class TrendingDto {
  hashtags: {
    tag: string;
    count: number;
    trend: 'up' | 'down' | 'stable';
    posts: PostDto[];
  }[];
  
  popularPosts: PostDto[];
  
  activeUsers: {
    id: string;
    fullName: string;
    profilePicture?: string;
    department: Department;
    postsCount: number;
    engagementRate: number;
  }[];

  departmentStats: {
    department: Department;
    postsCount: number;
    activeUsers: number;
    engagementRate: number;
  }[];
}