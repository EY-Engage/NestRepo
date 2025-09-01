import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { Participant } from './entities/participant.entity';
import { MessageStatus } from './entities/message-status.entity';
import { ConversationInvite } from './entities/conversation-invite.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { IntegrationModule } from '../integration/integration.module';
import { AuthModule } from 'src/auth/auth.module';
import { MessageReaction } from './entities/message-reaction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      Message,
      Participant,
      MessageStatus,
      MessageReaction,
      ConversationInvite,
    ]),
    NotificationsModule,
    IntegrationModule,
    AuthModule
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}
