import { 
  IsString, 
  IsBoolean, 
  IsOptional, 
  IsArray, 
  IsUUID, 
  MaxLength, 
  MinLength,
  IsEnum 
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreatePostDto {
  @IsString()
  @MinLength(1, { message: 'Le contenu ne peut pas être vide' })
  @MaxLength(5000, { message: 'Le contenu ne peut pas dépasser 5000 caractères' })
  @Transform(({ value }) => value?.trim())
  content: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  files?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  // Transformer pour gérer les JSON strings et les arrays FormData
  @Transform(({ value }) => {
    if (!value) return [];
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [value]; // Si c'est une string unique
      }
    }
    if (Array.isArray(value)) return value;
    return [];
  })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  // Transformer pour gérer les JSON strings et les arrays FormData
  @Transform(({ value }) => {
    if (!value) return [];
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [value]; // Si c'est une string unique
      }
    }
    if (Array.isArray(value)) return value;
    return [];
  })
  mentions?: string[];

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value === 'true';
    }
    return value;
  })
  isPublic?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value === 'true';
    }
    return value;
  })
  departmentOnly?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value === 'true';
    }
    return value;
  })
  allowComments?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value === 'true';
    }
    return value;
  })
  allowShares?: boolean = true;

  @IsOptional()
  @IsUUID()
  originalPostId?: string;
}

export class UpdatePostDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  @Transform(({ value }) => value?.trim())
  content?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsBoolean()
  departmentOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  allowComments?: boolean;

  @IsOptional()
  @IsBoolean()
  allowShares?: boolean;
}

export class SharePostDto {
  @IsUUID()
  originalPostId: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => value?.trim())
  comment?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean = true;

  @IsOptional()
  @IsBoolean()
  departmentOnly?: boolean = false;
}
