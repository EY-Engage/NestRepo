import { registerAs } from '@nestjs/config';
import { Transport } from '@nestjs/microservices';

export default registerAs('kafka', () => ({
  transport: Transport.KAFKA as const,
  options: {
    client: {
      clientId: process.env.KAFKA_CLIENT_ID || 'ey-engage-nestjs-local',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      retry: {
        retries: 5,
        initialRetryTime: 500,
        maxRetryTime: 10000,
        factor: 0.2,
        multiplier: 2,
      },
      connectionTimeout: 5000,
      requestTimeout: 10000,
      // Pour développement local
      ssl: false,
      sasl: undefined,
    },
    consumer: {
      groupId: process.env.KAFKA_GROUP_ID || 'ey-engage-group-local',
      allowAutoTopicCreation: true,
      sessionTimeout: 10000,
      rebalanceTimeout: 20000,
      heartbeatInterval: 3000,
      maxWaitTimeInMs: 5000,
      retry: {
        retries: 5,
        initialRetryTime: 500,
        maxRetryTime: 10000,
      },
    },
    producer: {
      retry: {
        retries: 5,
        initialRetryTime: 500,
        maxRetryTime: 10000,
      },
      allowAutoTopicCreation: true,
      transactionTimeout: 10000,
      maxInFlightRequests: 1,
      idempotent: false, // Simplifié pour le dev
    },
  },
}));

// Configuration pour développement avec Kafka embarqué (optionnel)
export const embeddedKafkaConfig = () => ({
  transport: Transport.KAFKA as const,
  options: {
    client: {
      clientId: 'ey-engage-embedded',
      brokers: ['localhost:9093'], // Port différent pour éviter les conflits
      retry: {
        retries: 3,
        initialRetryTime: 100,
        maxRetryTime: 5000,
      },
      connectionTimeout: 3000,
      requestTimeout: 5000,
    },
    consumer: {
      groupId: 'ey-engage-embedded-group',
      allowAutoTopicCreation: true,
      sessionTimeout: 6000,
      heartbeatInterval: 2000,
      maxWaitTimeInMs: 3000,
    },
    producer: {
      allowAutoTopicCreation: true,
      transactionTimeout: 5000,
      maxInFlightRequests: 1,
    },
  },
});

export const KAFKA_TOPICS = {
  // Notifications from .NET Core
  EVENT_CREATED: 'event.created',
  EVENT_APPROVED: 'event.approved',
  EVENT_REJECTED: 'event.rejected',
  PARTICIPATION_REQUESTED: 'participation.requested',
  PARTICIPATION_APPROVED: 'participation.approved',
  PARTICIPATION_REJECTED: 'participation.rejected',
  JOB_APPLIED: 'job.applied',
  JOB_INTERVIEW_SCHEDULED: 'job.interview.scheduled',
  USER_CREATED: 'user.created',
  COMMENT_CREATED: 'comment.created',
  
  // Social Network notifications
  POST_CREATED: 'social.post.created',
  POST_LIKED: 'social.post.liked',
  POST_COMMENTED: 'social.post.commented',
  POST_SHARED: 'social.post.shared',
  USER_FOLLOWED: 'social.user.followed',
  
  // Chat notifications
  MESSAGE_SENT: 'chat.message.sent',
  CONVERSATION_CREATED: 'chat.conversation.created',
  
  // Admin notifications
  CONTENT_FLAGGED: 'admin.content.flagged',
  USER_REPORTED: 'admin.user.reported',

  // Job application notification
  JOB_APPLICATION_RECEIVED: 'job.application.received',
  NOTIFICATION_CREATED: 'notification.created',
} as const;

export type KafkaTopics = typeof KAFKA_TOPICS[keyof typeof KAFKA_TOPICS];