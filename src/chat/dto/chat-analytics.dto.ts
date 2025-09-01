import { ConversationType } from "src/shared/enums/conversation-type.enum";
import { Department } from "src/shared/enums/department.enum";
import { MessageType } from "src/shared/enums/message-type.enum";

export class ChatAnalyticsDto {
  totalConversations: number;
  activeConversations: number;
  totalMessages: number;
  dailyMessages: number;
  weeklyMessages: number;
  monthlyMessages: number;

  conversationsByType: {
    type: ConversationType;
    count: number;
  }[];

  conversationsByDepartment: {
    department: Department;
    count: number;
  }[];

  topActiveConversations: {
    id: string;
    name: string;
    messagesCount: number;
    participantsCount: number;
    lastActivity: Date;
  }[];

  topActiveUsers: {
    userId: string;
    userName: string;
    messagesCount: number;
    conversationsCount: number;
  }[];

  messageTypeStats: {
    type: MessageType;
    count: number;
    percentage: number;
  }[];

  averageResponseTime: number;
  averageConversationDuration: number;
}