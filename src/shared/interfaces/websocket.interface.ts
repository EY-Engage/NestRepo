import { Department } from "../enums/department.enum";
import { Role } from "../enums/role.enum";

export interface ISocketUser {
  id: string;
  fullName: string;
  email: string;
  department: Department;
  roles: Role[];
  isOnline: boolean;
  lastSeen: Date;
  socketId: string;
}

export interface IOnlineUsers {
  [userId: string]: ISocketUser;
}

export interface ITypingUsers {
  [conversationId: string]: {
    [userId: string]: {
      userName: string;
      timestamp: Date;
    };
  };
}