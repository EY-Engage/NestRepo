import { Department } from "src/shared/enums/department.enum";

export class SocialAnalyticsDto {
  totalPosts: number;
  totalComments: number;
  totalReactions: number;
  totalFollows: number;
  
  dailyStats: {
    date: Date;
    posts: number;
    comments: number;
    reactions: number;
    activeUsers: number;
  }[];
  
  popularHashtags: {
    tag: string;
    count: number;
  }[];
  
  topUsers: {
    id: string;
    fullName: string;
    department: Department;
    postsCount: number;
    engagementScore: number;
  }[];
  
  departmentStats: {
    department: Department;
    postsCount: number;
    usersCount: number;
    engagementRate: number;
  }[];
  
  engagementRate: number;
  growthRate: number;
}