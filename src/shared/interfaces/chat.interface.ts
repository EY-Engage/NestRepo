import { ConversationType } from "../enums/conversation-type.enum";
import { Department } from "../enums/department.enum";
import { MessageType } from "../enums/message-type.enum";
import { IReaction } from "./social.interface";

export interface IConversation {
  id: string;
  type: ConversationType;
  name?: string;
  description?: string;
  creatorId: string;
  department?: Department;
  isActive: boolean;
  isPrivate: boolean;
  lastMessageAt?: Date;
  lastMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderProfilePicture?: string;
  type: MessageType;
  content: string;
  attachments?: string[];
  replyToId?: string;
  reactions?: IReaction[];
  isEdited: boolean;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt?: Date;
}

export interface IParticipant {
  id: string;
  conversationId: string;
  userId: string;
  userName: string;
  userProfilePicture?: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: Date;
  lastSeenAt?: Date;
  isActive: boolean;
}