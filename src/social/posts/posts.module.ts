import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { Reaction } from './entities/reaction.entity';
import { PostView } from './entities/post-view.entity';
import { Follow } from '../follows/entities/follow.entity';
import { NotificationsModule } from '../../notifications/notifications.module';
import { IntegrationModule } from '../../integration/integration.module';
import { AuthModule } from 'src/auth/auth.module';
import { User } from './entities/user.entity';
import { Bookmark } from './entities/bookmark.entity';
import { Flag, FlagStatus } from './entities/flag.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Post,
      Comment,
      Reaction,
      PostView,
      Follow,
      User,
      Bookmark,
      Flag,
    ]),
    NotificationsModule,
    IntegrationModule,
    AuthModule,
  ],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
