import { 
  IsString, 
  IsEnum, 
  IsOptional, 
  IsBoolean, 
  IsArray, 
  IsUUID, 
  MaxLength, 
  MinLength,
  IsObject,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ConversationType } from 'src/shared/enums/conversation-type.enum';
import { Department } from 'src/shared/enums/department.enum';

export class CreateConversationDto {
  @IsEnum(ConversationType)
  type: ConversationType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }) => value?.trim())
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => value?.trim())
  description?: string;

  @IsOptional()
  @IsEnum(Department)
  department?: Department;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean = false;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  participantIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  settings?: {
    allowInvites?: boolean;
    allowFiles?: boolean;
    allowVoiceMessages?: boolean;
    maxParticipants?: number;
    autoDeleteMessages?: boolean;
    autoDeleteAfterDays?: number;
  };
}

export class UpdateConversationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }) => value?.trim())
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => value?.trim())
  description?: string;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  settings?: {
    allowInvites?: boolean;
    allowFiles?: boolean;
    allowVoiceMessages?: boolean;
    maxParticipants?: number;
    autoDeleteMessages?: boolean;
    autoDeleteAfterDays?: number;
  };
}