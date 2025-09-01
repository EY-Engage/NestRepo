import { Department } from "../enums/department.enum";

export interface IDepartmentStats {
  department: Department;
  totalUsers: number;
  activeUsers: number;
  totalPosts: number;
  totalEvents: number;
  totalJobs: number;
}