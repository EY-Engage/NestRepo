// src/notifications/dto/create-notification.dto.ts
import { IsString, IsEnum, IsOptional, IsUUID, IsObject, ValidateNested } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { NotificationType, NotificationPriority } from '../entities/notification.entity';

export class NotificationMetadataDto {
  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  actionUrl?: string;

  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  actorName?: string;

  @IsOptional()
  @IsString()
  actorAvatar?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  additionalData?: any;
}

export class CreateNotificationDto {
  @IsUUID('4', { message: 'recipientId must be a valid UUID' })
  @Transform(({ value }) => value?.toString())
  recipientId: string;

  @IsString({ message: 'recipientName must be a string' })
  @Transform(({ value }) => value?.toString() || '')
  recipientName: string;

  @IsEnum(NotificationType, { 
    message: `type must be one of the following values: ${Object.values(NotificationType).join(', ')}`
  })
  type: NotificationType;

  @IsString({ message: 'title must be a string' })
  @Transform(({ value }) => value?.toString() || '')
  title: string;

  @IsString({ message: 'message must be a string' })
  @Transform(({ value }) => value?.toString() || '')
  message: string;

  @IsEnum(NotificationPriority)
  @IsOptional()
  @Transform(({ value }) => value || NotificationPriority.MEDIUM)
  priority?: NotificationPriority = NotificationPriority.MEDIUM;

  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationMetadataDto)
  metadata?: NotificationMetadataDto;

  @IsOptional()
  @Transform(({ value }) => value ? new Date(value) : undefined)
  expiresAt?: Date;
}

// DTO pour les notifications en bulk
export class RecipientInfoDto {
  @IsUUID('4')
  @Transform(({ value }) => value?.toString())
  id: string;

  @IsString()
  @Transform(({ value }) => value?.toString() || '')
  name: string;
}

export class NotificationDataDto {
  @IsEnum(NotificationType)
  type: NotificationType;

  @IsString()
  @Transform(({ value }) => value?.toString() || '')
  title: string;

  @IsString()
  @Transform(({ value }) => value?.toString() || '')
  message: string;

  @IsEnum(NotificationPriority)
  @IsOptional()
  @Transform(({ value }) => value || NotificationPriority.MEDIUM)
  priority?: NotificationPriority = NotificationPriority.MEDIUM;

  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationMetadataDto)
  metadata?: NotificationMetadataDto;
}

export class CreateBulkNotificationDto {
  @ValidateNested({ each: true })
  @Type(() => RecipientInfoDto)
  recipients: RecipientInfoDto[];

  @ValidateNested()
  @Type(() => NotificationDataDto)
  notification: NotificationDataDto;
}