import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FollowsController } from './follows.controller';
import { FollowsService } from './follows.service';
import { Follow } from './entities/follow.entity';
import { NotificationsModule } from '../../notifications/notifications.module';
import { IntegrationModule } from '../../integration/integration.module';
import { AuthModule } from 'src/auth/auth.module';
import { User } from '../posts/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Follow,User]),
    NotificationsModule,
    IntegrationModule,
    AuthModule
  ],
  controllers: [FollowsController],
  providers: [FollowsService],
  exports: [FollowsService],
})
export class FollowsModule {}
