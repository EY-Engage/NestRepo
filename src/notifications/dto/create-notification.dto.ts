import { IsEnum, IsString, IsUUID, IsOptional, IsBoolean, IsObject, IsArray } from 'class-validator';
import { Department } from 'src/shared/enums/department.enum';
import { NotificationType } from 'src/shared/enums/notification-type.enum';
import { Role } from 'src/shared/enums/role.enum';

export class CreateNotificationDto {
  @IsEnum(NotificationType)
  type: NotificationType;

  @IsString()
  title: string;

  @IsString()
  content: string;

  @IsUUID()
  userId: string;

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
  @IsString()
  targetType?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, any>;

  @IsOptional()
  @IsEnum(Department)
  departmentFilter?: Department;

  @IsOptional()
  @IsArray()
  @IsEnum(Role, { each: true })
  roleFilter?: Role[];

  @IsOptional()
  @IsString()
  actionUrl?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  priority?: 'low' | 'normal' | 'high' | 'urgent';

  @IsOptional()
  @IsBoolean()
  emailSent?: boolean;

  @IsOptional()
  @IsBoolean()
  pushSent?: boolean;
}

