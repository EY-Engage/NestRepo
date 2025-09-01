import { IsString, MinLength, MaxLength, IsOptional, IsEnum } from "class-validator";
import { Department } from "src/shared/enums/department.enum";
import { Transform } from "class-transformer";
import { PostDto } from "../posts/dto/post.dto";

export class SearchQueryDto {
  @IsString()
  @MinLength(2, { message: 'La recherche doit contenir au moins 2 caractères' })
  @MaxLength(100)
  @Transform(({ value }) => value?.trim())
  query: string;

  @IsOptional()
  @IsString()
  type?: 'posts' | 'users' | 'all' = 'all';

  @IsOptional()
  @IsEnum(Department)
  department?: Department;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  limit?: number = 20;
}

export class SearchResultDto {
  posts?: PostDto[];
  users?: {
    id: string;
    fullName: string;
    email: string;
    profilePicture?: string;
    department: Department;
    fonction: string;
    isFollowing?: boolean;
    mutualConnections?: number;
  }[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}