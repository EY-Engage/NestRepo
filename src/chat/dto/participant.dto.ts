import { IsUUID, IsOptional, IsEnum, IsString, MaxLength, IsBoolean } from "class-validator";
import { Department } from "src/shared/enums/department.enum";

export class AddParticipantDto {
  @IsUUID()
  conversationId: string;

  @IsUUID()
  userId: string;

  @IsOptional()
  @IsEnum(['admin', 'member'])
  role?: 'admin' | 'member' = 'member';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nickname?: string;
}

export class UpdateParticipantDto {
  @IsOptional()
  @IsEnum(['admin', 'member'])
  role?: 'admin' | 'member';

  @IsOptional()
  @IsBoolean()
  canSendMessages?: boolean;

  @IsOptional()
  @IsBoolean()
  canAddParticipants?: boolean;

  @IsOptional()
  @IsBoolean()
  canDeleteMessages?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nickname?: string;

  @IsOptional()
  @IsBoolean()
  isMuted?: boolean;

  @IsOptional()
  mutedUntil?: Date;
}

export class ParticipantDto {
  id: string;
  conversationId: string;
  userId: string;
  userName: string;
  userProfilePicture?: string;
  userDepartment: Department;
  role: 'owner' | 'admin' | 'member';
  isActive: boolean;
  isMuted: boolean;
  mutedUntil?: Date;
  canSendMessages: boolean;
  canAddParticipants: boolean;
  canDeleteMessages: boolean;
  nickname?: string;
  joinedAt: Date;
  lastSeenAt?: Date;
  unreadCount: number;
  leftAt?: Date;
  invitedById?: string;
  invitedByName?: string;

  // Statut en ligne (temps réel)
  isOnline?: boolean;
  isTyping?: boolean;
}
