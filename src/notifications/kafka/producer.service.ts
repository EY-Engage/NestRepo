import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer, ProducerRecord } from 'kafkajs';
import { KAFKA_TOPICS } from '../../config/kafka.config';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private kafka: Kafka;
  private producer: Producer;

  constructor(private configService: ConfigService) {
    this.kafka = new Kafka(this.configService.get('kafka.options.client'));
    this.producer = this.kafka.producer(this.configService.get('kafka.options.producer'));
  }

  async onModuleInit() {
    await this.producer.connect();
  }

  async onModuleDestroy() {
    await this.producer.disconnect();
  }

  async publish(topic: string, message: any): Promise<void> {
    const producerRecord: ProducerRecord = {
      topic,
      messages: [
        {
          key: message.id || Date.now().toString(),
          value: JSON.stringify(message),
          timestamp: Date.now().toString(),
        },
      ],
    };

    await this.producer.send(producerRecord);
  }

  // Méthodes spécifiques pour chaque type de notification
  async publishNotification(notification: any) {
    await this.publish(KAFKA_TOPICS.NOTIFICATION_CREATED, notification);
  }

  async publishSocialEvent(event: any) {
    switch (event.type) {
      case 'POST_CREATED':
        await this.publish(KAFKA_TOPICS.POST_CREATED, event);
        break;
      case 'POST_LIKED':
        await this.publish(KAFKA_TOPICS.POST_LIKED, event);
        break;
      case 'POST_COMMENTED':
        await this.publish(KAFKA_TOPICS.POST_COMMENTED, event);
        break;
      default:
        console.warn(`Type d'événement social non géré: ${event.type}`);
    }
  }

  async publishChatEvent(event: any) {
    switch (event.type) {
      case 'MESSAGE_SENT':
        await this.publish(KAFKA_TOPICS.MESSAGE_SENT, event);
        break;
      case 'CONVERSATION_CREATED':
        await this.publish(KAFKA_TOPICS.CONVERSATION_CREATED, event);
        break;
      default:
        console.warn(`Type d'événement chat non géré: ${event.type}`);
    }
  }
}