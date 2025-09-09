// src/social/posts/dto/create-post.dto.ts - Correction pour mentions
import { 
  IsString, 
  IsBoolean, 
  IsOptional, 
  IsArray, 
  IsUUID, 
  MaxLength, 
  MinLength,
  IsEnum,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

// ✅ NOUVEAU: DTO pour valider les mentions
export class MentionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  fullName: string;

  @IsOptional()
  @IsUUID()
  userId?: string; // Optionnel, sera résolu côté serveur si pas fourni
}

export class CreatePostDto {
  @IsString()
  @MinLength(1, { message: 'Le contenu ne peut pas être vide' })
  @MaxLength(5000, { message: 'Le contenu ne peut pas dépasser 5000 caractères' })
  @Transform(({ value }) => value?.trim())
  content: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10, { message: 'Maximum 10 images autorisées' })
  images?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(5, { message: 'Maximum 5 fichiers autorisés' })
  files?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20, { message: 'Maximum 20 tags autorisés' })
  // ✅ AMÉLIORATION: Transformer pour gérer les JSON strings et les arrays FormData
  @Transform(({ value }) => {
    if (!value) return [];
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        // Si ce n'est pas du JSON, traiter comme une liste séparée par des virgules
        return value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      }
    }
    if (Array.isArray(value)) return value;
    return [];
  })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50, { message: 'Maximum 50 mentions autorisées' })
  // ✅ CORRECTION MAJEURE: Transformer pour gérer les mentions avec noms complets
  @Transform(({ value }) => {
    if (!value) return [];
    
    if (typeof value === 'string') {
      try {
        // Essayer de parser du JSON
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // Si ce n'est pas du JSON, traiter comme du texte brut
        // Extraire les mentions avec regex pour supporter @nom complet
        const mentionRegex = /@([a-zA-ZÀ-ÿ\s\-.']{2,50})(?=\s|$|@|[.,!?;:\n])/g;
        const mentions: string[] = [];
        let match;
        
        while ((match = mentionRegex.exec(value)) !== null) {
          const mention = match[1].trim();
          if (mention && mention.length >= 2 && mention.length <= 50 && !/^\d+$/.test(mention)) {
            mentions.push(mention);
          }
        }
        
        return mentions;
      }
    }
    
    if (Array.isArray(value)) {
      // Nettoyer chaque mention
      return value.map(mention => {
        if (typeof mention === 'string') {
          const cleaned = mention.replace(/^@/, '').trim();
          if (cleaned.length >= 2 && cleaned.length <= 50 && !/^\d+$/.test(cleaned)) {
            return cleaned;
          }
        }
        return null;
      }).filter(mention => mention !== null);
    }
    
    return [];
  })
  mentions?: string[]; // ✅ Maintenant accepte les noms complets

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value === 'true';
    }
    return value !== false; // Par défaut true
  })
  isPublic?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value === 'true';
    }
    return value === true;
  })
  departmentOnly?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value === 'true';
    }
    return value !== false; // Par défaut true
  })
  allowComments?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value === 'true';
    }
    return value !== false; // Par défaut true
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
  @ArrayMaxSize(20)
  @Transform(({ value }) => {
    if (!value) return [];
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      }
    }
    return Array.isArray(value) ? value : [];
  })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  // ✅ Même transformation pour les mentions en update
  @Transform(({ value }) => {
    if (!value) return [];
    
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        const mentionRegex = /@([^@\n]+?)(?=\s|$|@|[.,!?;:])/g;
        const mentions: string[] = [];
        let match;
        
        while ((match = mentionRegex.exec(value)) !== null) {
          const mention = match[1].trim();
          if (mention && mention.length > 0) {
            mentions.push(mention);
          }
        }
        
        return mentions;
      }
    }
    
    if (Array.isArray(value)) {
      return value.map(mention => {
        if (typeof mention === 'string') {
          return mention.replace(/^@/, '').trim();
        }
        return mention;
      }).filter(mention => mention && mention.length > 0);
    }
    
    return [];
  })
  mentions?: string[];

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
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  // ✅ Support des mentions dans les commentaires de partage aussi
  @Transform(({ value }) => {
    if (!value) return [];
    
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        const mentionRegex = /@([^@\n]+?)(?=\s|$|@|[.,!?;:])/g;
        const mentions: string[] = [];
        let match;
        
        while ((match = mentionRegex.exec(value)) !== null) {
          const mention = match[1].trim();
          if (mention && mention.length > 0) {
            mentions.push(mention);
          }
        }
        
        return mentions;
      }
    }
    
    if (Array.isArray(value)) {
      return value.map(mention => {
        if (typeof mention === 'string') {
          return mention.replace(/^@/, '').trim();
        }
        return mention;
      }).filter(mention => mention && mention.length > 0);
    }
    
    return [];
  })
  mentions?: string[];

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value === 'true';
    }
    return value !== false;
  })
  isPublic?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value === 'true';
    }
    return value === true;
  })
  departmentOnly?: boolean = false;
}

// ✅ NOUVEAU: DTO pour l'extraction de mentions côté client
export class ExtractMentionsDto {
  @IsString()
  content: string;

  // Méthode statique pour extraire les mentions du contenu
  static extractMentions(content: string): string[] {
    if (!content) return [];
    
    // ✅ Regex améliorée pour supporter les noms avec espaces et caractères spéciaux
    const mentionRegex = /@([a-zA-ZÀ-ÿ0-9\s\-._']+?)(?=\s|$|@|[.,!?;:\n])/g;
    const mentions: string[] = [];
    let match;
    
    while ((match = mentionRegex.exec(content)) !== null) {
      const mention = match[1].trim();
      if (mention && mention.length > 0 && mention.length <= 100) {
        mentions.push(mention);
      }
    }
    
    // Retourner des mentions uniques
    return [...new Set(mentions)];
  }

  // Méthode pour remplacer les mentions dans le texte
  static replaceMentions(content: string, mentionMap: Record<string, string>): string {
    if (!content || !mentionMap) return content;
    
    let result = content;
    
    Object.entries(mentionMap).forEach(([fullName, userId]) => {
      // Remplacer @FullName par @userId temporairement pour le traitement backend
      const regex = new RegExp(`@${fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$|@|[.,!?;:\\n])`, 'g');
      result = result.replace(regex, `@${userId}`);
    });
    
    return result;
  }

  // Méthode pour restaurer les mentions affichées (userId → fullName)
  static restoreMentions(content: string, userMap: Record<string, string>): string {
    if (!content || !userMap) return content;
    
    let result = content;
    
    Object.entries(userMap).forEach(([userId, fullName]) => {
      // Remplacer @userId par @FullName pour l'affichage
      const regex = new RegExp(`@${userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$|@|[.,!?;:\\n])`, 'g');
      result = result.replace(regex, `@${fullName}`);
    });
    
    return result;
  }
}

// ✅ NOUVEAU: DTO pour rechercher les utilisateurs à mentionner
export class MentionSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  query: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value) || 10)
  @MaxLength(50)
  limit?: number = 10;
}

// ✅ Réponse pour la recherche de mentions
export interface MentionSearchResult {
  id: string;
  fullName: string;
  email: string;
  department: string;
  profilePicture?: string;
  isActive: boolean;
}

export interface MentionSearchResponse {
  users: MentionSearchResult[];
  total: number;
  query: string;
}