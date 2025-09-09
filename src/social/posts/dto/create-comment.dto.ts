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

  // Méthode statique pour extraire les mentions du contenu
  static extractMentions(content: string): string[] {
    if (!content) return [];
    
    // Regex plus stricte pour éviter les faux positifs
    const mentionRegex = /@([a-zA-ZÀ-ÿ\s\-.']{2,50})(?=\s|$|@|[.,!?;:\n])/g;
    const mentions: string[] = [];
    let match;
    
    while ((match = mentionRegex.exec(content)) !== null) {
      const mention = match[1].trim();
      // Validation plus stricte
      if (mention && 
          mention.length >= 2 && 
          mention.length <= 50 && 
          !/^\d+$/.test(mention) && // Pas que des chiffres
          !/^[a-f0-9-]{8,}$/i.test(mention)) { // Pas des IDs partiels
        mentions.push(mention);
      }
    }
    
    // Retourner des mentions uniques
    return [...new Set(mentions)];
  }
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