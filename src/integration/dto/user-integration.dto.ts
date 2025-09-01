import { IsUUID, IsString, IsOptional, IsEnum, IsBoolean, IsDate } from "class-validator";
import { Department } from "src/shared/enums/department.enum";
import { Transform } from "class-transformer";

export class UserIntegrationDto {
  @IsUUID()
  id: string;

  @IsString()
  fullName: string;

  @IsString()
  email: string;

  @IsOptional()
  @IsString()
  profilePicture?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsString()
  fonction: string;

  @IsEnum(Department)
  department: Department;

  @IsString()
  sector: string;

  @IsBoolean()
  isActive: boolean;

  @IsBoolean()
  isFirstLogin: boolean;

  @Transform(({ value }) => new Date(value))
  @IsDate()
  createdAt: Date;

  @Transform(({ value }) => new Date(value))
  @IsDate()
  updatedAt: Date;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  roles?: string[];
}
