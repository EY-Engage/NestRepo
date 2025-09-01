import { Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { FollowsModule } from './follows/follows.module';
import { PostsModule } from './posts/posts.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [PostsModule, FollowsModule,AuthModule],
  controllers: [SocialController],
  exports: [PostsModule, FollowsModule],
})
export class SocialModule {}