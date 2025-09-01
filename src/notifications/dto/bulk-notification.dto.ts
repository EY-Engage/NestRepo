import { IsArray, IsUUID, IsEnum, IsString, IsOptional, IsObject } from "class-validator";
import { Department } from "src/shared/enums/department.enum";
import { NotificationType } from "src/shared/enums/notification-type.enum";
import { Role } from "src/shared/enums/role.enum";

export class BulkNotificationDto {
  @IsArray()
  @IsUUID('4', { each: true })
  userIds: string[];

  @IsEnum(NotificationType)
  type: NotificationType;

  @IsString()
  title: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsUUID()
  senderId?: string;

  @IsOptional()
  @IsString()
  senderName?: string;

  @IsOptional()
  @IsUUID()
  targetId?: string;

  @IsOptional()
  @IsString() // Ajout de la propriété targetType
  targetType?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, any>;

  @IsOptional()
  @IsString()
  actionUrl?: string;

  @IsOptional()
  @IsEnum(Department)
  departmentFilter?: Department;

  @IsOptional()
  @IsArray()
  @IsEnum(Role, { each: true })
  roleFilter?: Role[];
}