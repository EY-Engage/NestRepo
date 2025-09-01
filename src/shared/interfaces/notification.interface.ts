import { Department } from "../enums/department.enum";
import { NotificationType } from "../enums/notification-type.enum";
import { Role } from "../enums/role.enum";


export interface INotification {
  id: string;
  type: NotificationType;
  title: string;
  content: string;
  userId: string;
  senderId?: string;
  targetId?: string;
  targetType?: string;
  data?: Record<string, any>;
  isRead: boolean;
  isDeleted: boolean;
  departmentFilter?: Department;
  roleFilter?: Role[];
  createdAt: Date;
  readAt?: Date;
  expiresAt?: Date;
}

export interface INotificationPreferences {
  userId: string;
  emailNotifications: boolean;
  pushNotifications: boolean;
  smsNotifications: boolean;
  notificationTypes: NotificationType[];
}
