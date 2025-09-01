import { IsUUID, IsString, IsDate, IsOptional, IsEnum } from "class-validator";
import { Department } from "src/shared/enums/department.enum";
import { Transform }from "class-transformer";

export class CommentIntegrationDto {
  @IsUUID()
  id: string;

  @IsUUID()
  eventId: string;

  @IsString()
  eventTitle: string;

  @IsUUID()
  authorId: string;

  @IsString()
  authorName: string;

  @IsString()
  content: string;

  @Transform(({ value }) => new Date(value))
  @IsDate()
  createdAt: Date;

  @IsOptional()
  @IsUUID()
  eventOrganizerId?: string;

  @IsOptional()
  @IsEnum(Department)
  eventDepartment?: Department;
}
