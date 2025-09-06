import { IsOptional, IsEnum, IsBoolean, IsString, IsArray, IsIn } from "class-validator";
import { Transform } from "class-transformer";
import { PostDto } from "../posts/dto/post.dto";

export class FeedQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  limit?: number = 20;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  followingOnly?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  departmentOnly?: boolean = false;
    @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  myDepartment?: boolean = false;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
    }
    return value;
  })
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @IsIn(['recent', 'popular', 'trending'])
  sortBy?: 'recent' | 'popular' | 'trending' = 'recent';
}

export class FeedResponseDto {
  posts: PostDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}