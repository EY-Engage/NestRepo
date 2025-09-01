import { HttpModule } from '@nestjs/axios';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KafkaConsumerService } from './kafka/consumer.service';
import { KafkaProducerService } from './kafka/producer.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';
import { AuthModule } from 'src/auth/auth.module';
import { Notification } from './entities/notification.entity'; // AJOUTER CET IMPORT

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]), // Maintenant Notification est défini
    HttpModule,
    ConfigModule,
    AuthModule,
    // Supprimer l'import circulaire qui n'est pas nécessaire
    // forwardRef(() => NotificationsModule),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    KafkaProducerService,
    KafkaConsumerService,
  ],
  exports: [
    NotificationsService,
    KafkaProducerService,
    // Ne pas exporter le gateway sauf si nécessaire
  ],
})
export class NotificationsModule {}