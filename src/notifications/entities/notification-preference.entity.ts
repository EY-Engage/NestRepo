// src/notifications/entities/notification-preference.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NotificationType } from './notification.entity';

@Entity('notification_preferences')
@Index(['userId'], { unique: true })
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { unique: true })
  userId: string;

  @Column('jsonb', { default: {} })
  emailPreferences: Record<NotificationType, boolean>;

  @Column('jsonb', { default: {} })
  pushPreferences: Record<NotificationType, boolean>;

  @Column({ default: true })
  emailEnabled: boolean;

  @Column({ default: true })
  pushEnabled: boolean;

  @Column({ default: false })
  doNotDisturb: boolean;

  @Column('jsonb', { nullable: true })
  doNotDisturbSchedule?: {
    start: string; // HH:mm
    end: string; // HH:mm
    timezone: string;
  };

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}