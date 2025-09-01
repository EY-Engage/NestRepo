import { Department } from "src/shared/enums/department.enum";
import { MessageType } from "src/shared/enums/message-type.enum";
import { MessageReactionDto } from "./reaction.dto";

export class MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderProfilePicture?: string;
  senderDepartment: Department;
  type: MessageType;
  content: string;
  attachments?: string[];
  mentions?: string[];
  replyToId?: string;
  replyToContent?: string;
  replyToSenderName?: string;
  isEdited: boolean;
  isDeleted: boolean;
  isSystem: boolean;
  isPinned: boolean;
  reactionsCount: number;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  deletedById?: string;

  // Données relatives à l'utilisateur connecté
  canEdit?: boolean;
  canDelete?: boolean;
  canReact?: boolean;
  isRead?: boolean;
  deliveredAt?: Date;
  readAt?: Date;
  reactions?: MessageReactionDto[];
}
