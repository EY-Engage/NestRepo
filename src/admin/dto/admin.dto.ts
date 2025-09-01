// dto/admin.dto.ts
import { IsEnum, IsOptional, IsBoolean, IsNumber, IsString, Min, Max } from 'class-validator';
import { ContentType } from 'src/shared/enums/content-type.enum';
import { Department } from 'src/shared/enums/department.enum';
import { FlagStatus } from 'src/social/posts/entities/flag.entity';

export class ModerationActionDto {
  @IsString()
  targetId: string;

  @IsEnum(ContentType)
  targetType: ContentType;

  @IsEnum(['approve', 'hide', 'delete', 'warn'])
  action: string;

  @IsString()
  reason: string;

  @IsBoolean()
  @IsOptional()
  notifyUser?: boolean;

  @IsBoolean()
  @IsOptional()
  banUser?: boolean;

  @IsNumber()
  @IsOptional()
  banDuration?: number;
}

export class FlagStatsQueryDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsEnum(Department)
  department?: Department;
}

export class UserSearchQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(Department)
  department?: Department;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  hasWarnings?: boolean;

  @IsNumber()
  @Min(1)
  page: number = 1;

  @IsNumber()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class ContentSearchQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsEnum(ContentType)
  type: ContentType;

  @IsOptional()
  @IsString()
  authorId?: string;

  @IsOptional()
  @IsEnum(Department)
  department?: Department;

  @IsOptional()
  @IsBoolean()
  isFlagged?: boolean;

  @IsNumber()
  @Min(1)
  page: number = 1;

  @IsNumber()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class FlaggedContentQueryDto {
  @IsOptional()
  @IsEnum(FlagStatus)
  status?: FlagStatus;

  @IsOptional()
  @IsEnum(ContentType)
  type?: ContentType;

  @IsOptional()
  @IsEnum(Department)
  department?: Department;

  @IsOptional()
  @IsBoolean()
  urgent?: boolean;

  @IsNumber()
  @Min(1)
  page: number = 1;

  @IsNumber()
  @Min(1)
  @Max(100)
  limit: number = 20;
}