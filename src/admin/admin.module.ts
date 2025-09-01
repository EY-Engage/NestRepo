// admin.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { Post } from '../social/posts/entities/post.entity';
import { Flag } from '../social/posts/entities/flag.entity';
import { PostsModule } from '../social/posts/posts.module';
import { JwtModule } from '@nestjs/jwt';
import { Bookmark } from 'src/social/posts/entities/bookmark.entity';
import { Reaction } from 'src/social/posts/entities/reaction.entity';
import { User } from 'src/social/posts/entities/user.entity';
import { ModerationHistory } from './entities/moderation-history.entity';
import { UserWarning } from './entities/user-warning.entity';
import { Comment } from 'src/social/posts/entities/comment.entity';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Post, Flag,Comment,Reaction,User,Bookmark,ModerationHistory,UserWarning]),
    PostsModule,JwtModule ,NotificationsModule
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}