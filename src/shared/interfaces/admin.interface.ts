import { IDepartmentStats } from "./department.interface";

export interface IAdminStats {
  totalUsers: number;
  activeUsers: number;
  totalPosts: number;
  totalConversations: number;
  totalNotifications: number;
  flaggedContent: number;
  reportedUsers: number;
  departmentStats: IDepartmentStats[];
  dailyActiveUsers: number;
  weeklyActiveUsers: number;
  monthlyActiveUsers: number;
}