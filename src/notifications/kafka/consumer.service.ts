import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { NotificationsService } from '../notifications.service';
import { KAFKA_TOPICS } from '../../config/kafka.config';
import { NotificationType } from 'src/shared/enums/notification-type.enum';
import { Role } from 'src/shared/enums/role.enum';

@Injectable()
export class KafkaConsumerService implements OnModuleInit {
  private kafka: Kafka;
  private consumer: Consumer;

  constructor(
    private configService: ConfigService,
    private notificationsService: NotificationsService,
  ) {
    this.kafka = new Kafka(this.configService.get('kafka.options.client'));
    this.consumer = this.kafka.consumer(this.configService.get('kafka.options.consumer'));
  }

  async onModuleInit() {
    await this.consumer.connect();
    await this.subscribeToTopics();
    await this.consumer.run({
      eachMessage: this.handleMessage.bind(this),
    });
  }

  private async subscribeToTopics() {
    const topics = Object.values(KAFKA_TOPICS);
    for (const topic of topics) {
      await this.consumer.subscribe({ topic });
    }
  }

  private async handleMessage({ topic, partition, message }: EachMessagePayload) {
    try {
      const value = message.value?.toString();
      if (!value) return;

      const data = JSON.parse(value);

      switch (topic) {
        case KAFKA_TOPICS.EVENT_CREATED:
          await this.handleEventCreated(data);
          break;
        case KAFKA_TOPICS.JOB_APPLICATION_RECEIVED:
          await this.handleJobApplicationReceived(data);
          break;
        default:
          console.warn(`Topic non géré: ${topic}`);
      }
    } catch (error) {
      console.error(`Erreur lors du traitement du message Kafka:`, error);
    }
  }

  private async handleEventCreated(data: any) {
    await this.notificationsService.createBulkNotification({
      userIds: data.adminIds, // Fournir un tableau d'IDs d'utilisateurs
      type: NotificationType.EVENT_CREATED,
      title: 'Nouvel événement en attente',
      content: `${data.organizerName} a créé l'événement "${data.title}" qui nécessite votre approbation.`,
      senderId: data.organizerId,
      senderName: data.organizerName,
      targetId: data.id,
      targetType: 'event',
      departmentFilter: data.organizerDepartment,
      roleFilter: [Role.ADMIN, Role.AGENT_EY],
      actionUrl: `/admin/events/${data.id}`,
      data: { eventId: data.id, eventTitle: data.title },
    });
  }

  private async handleJobApplicationReceived(data: any) {
    // Notifier le publisher du job
    await this.notificationsService.createNotification({
      type: NotificationType.JOB_APPLICATION_RECEIVED,
      title: 'Nouvelle candidature',
      content: `${data.candidateName} a postulé pour le poste "${data.jobTitle}".`,
      userId: data.jobPublisherId,
      senderId: data.candidateId,
      senderName: data.candidateName,
      targetId: data.jobId,
      targetType: 'job',
      actionUrl: `/admin/jobs/${data.jobId}/applications`,
      data: {
        applicationId: data.id,
        jobId: data.jobId,
        jobTitle: data.jobTitle,
        candidateName: data.candidateName,
        candidateEmail: data.candidateEmail,
      },
    });

    // Notifier les admins du département
    await this.notificationsService.createBulkNotification({
      userIds: data.adminIds, // Fournir un tableau d'IDs d'utilisateurs
      type: NotificationType.JOB_APPLICATION_RECEIVED,
      title: 'Nouvelle candidature reçue',
      content: `Une nouvelle candidature a été reçue pour le poste "${data.jobTitle}".`,
      senderId: data.candidateId,
      senderName: data.candidateName,
      targetId: data.jobId,
      targetType: 'job',
      departmentFilter: data.jobDepartment,
      roleFilter: [Role.ADMIN, Role.AGENT_EY],
      actionUrl: `/admin/jobs/${data.jobId}/applications`,
      data: {
        applicationId: data.id,
        jobId: data.jobId,
        jobTitle: data.jobTitle,
        candidateName: data.candidateName,
      },
    });
  }
}