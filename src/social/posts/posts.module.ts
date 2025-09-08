import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { Reaction } from './entities/reaction.entity';
import { Flag } from './entities/flag.entity';
import { PostView } from './entities/post-view.entity';
import { Bookmark } from './entities/bookmark.entity';
import { User } from './entities/user.entity';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Post, 
      Comment, 
      Reaction, 
      Flag, 
      PostView, 
      Bookmark,
      User
    ]),
    forwardRef(() => NotificationsModule),
    AuthModule 
  ],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}