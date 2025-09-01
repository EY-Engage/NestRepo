import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IntegrationService } from './integration.service';
import { IntegrationController } from './integration.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 3,
    }),
    ConfigModule,
    NotificationsModule,
    AuthModule
  ],
  controllers: [IntegrationController],
  providers: [IntegrationService],
  exports: [IntegrationService],
})
export class IntegrationModule {}