import { IsString, MinLength, MaxLength, IsUUID, IsOptional, IsArray } from "class-validator";
import { Transform } from "class-transformer";

export class CreateCommentDto {
  @IsString()
  @MinLength(1, { message: 'Le commentaire ne peut pas être vide' })
  @MaxLength(2000, { message: 'Le commentaire ne peut pas dépasser 2000 caractères' })
  @Transform(({ value }) => value?.trim())
  content: string;

  @IsUUID()
  postId: string;

  @IsOptional()
  @IsUUID()
  parentCommentId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentions?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];
}

export class UpdateCommentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  @Transform(({ value }) => value?.trim())
  content?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentions?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];
}