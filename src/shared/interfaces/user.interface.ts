import { Department } from "../enums/department.enum";
import { Role } from "../enums/role.enum";

export interface IUser {
  id: string;
  fullName: string;
  email: string;
  profilePicture?: string;
  phoneNumber?: string;
  fonction: string;
  department: Department;
  sector: string;
  isActive: boolean;
  isFirstLogin: boolean;
  createdAt: Date;
  updatedAt: Date;
  sessionId?: string;
  roles: Role[];
}


export interface IUserMinimal {
  id: string;
  fullName: string;
  email: string;
  profilePicture?: string;
  department: Department;
}