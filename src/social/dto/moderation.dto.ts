import { IsUUID, IsEnum, IsString, IsOptional, MaxLength } from "class-validator";
import { ContentType } from "src/shared/enums/content-type.enum";

export class FlagContentDto {
  @IsUUID()
  targetId: string;

  @IsEnum(ContentType)
  targetType: ContentType;

  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  // Aliases pour compatibilité (optionnel)
  get contentId(): string {
    return this.targetId;
  }

  get contentType(): ContentType {
    return this.targetType;
  }
}

export class ModerationActionDto {
  @IsUUID()
  targetId: string;

  @IsEnum(ContentType)
  targetType: ContentType;

  @IsString()
  @IsEnum(['approve', 'remove', 'warn'])
  action: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}