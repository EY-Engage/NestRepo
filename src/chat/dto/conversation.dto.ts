import { ConversationType } from "src/shared/enums/conversation-type.enum";
import { Department } from "src/shared/enums/department.enum";
import { ParticipantDto } from "./participant.dto";

export class ConversationDto {
  id: string;
  type: ConversationType;
  name?: string;
  description?: string;
  creatorId: string;
  creatorName: string;
  creatorProfilePicture?: string;
  department?: Department;
  isActive: boolean;
  isPrivate: boolean;
  lastMessageAt?: Date;
  lastMessage?: string;
  lastMessageById?: string;
  lastMessageByName?: string;
  messagesCount: number;
  participantsCount: number;
  tags?: string[];
  avatar?: string;
  settings?: any;
  createdAt: Date;
  updatedAt: Date;

  // Données relatives à l'utilisateur connecté
  unreadCount?: number;
  lastSeenAt?: Date;
  userRole?: 'owner' | 'admin' | 'member';
  isMuted?: boolean;
  canSendMessages?: boolean;
  canAddParticipants?: boolean;
  canDeleteMessages?: boolean;
  participants?: ParticipantDto[];
}