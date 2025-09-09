import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum NotificationType {
  // Events
  EVENT_CREATED = 'event_created',
  EVENT_APPROVED = 'event_approved',
  EVENT_REJECTED = 'event_rejected',
  EVENT_PARTICIPATION_REQUEST = 'event_participation_request',
  EVENT_PARTICIPATION_APPROVED = 'event_participation_approved',
  EVENT_PARTICIPATION_REJECTED = 'event_participation_rejected',
  EVENT_COMMENT = 'event_comment',
  EVENT_REMINDER = 'event_reminder',
  
  // Jobs
  JOB_POSTED = 'job_posted',
  JOB_APPLICATION = 'job_application',
  JOB_RECOMMENDATION = 'job_recommendation',
  JOB_INTERVIEW_SCHEDULED = 'job_interview_scheduled',
  JOB_STATUS_CHANGED = 'job_status_changed',
  
  // Social
  POST_MENTION = 'post_mention',
  POST_COMMENT = 'post_comment',
  POST_REACTION = 'post_reaction',
  POST_SHARE = 'post_share',
  POST_FLAGGED = 'post_flagged',
  
  // Moderation
  CONTENT_FLAGGED = 'content_flagged',
  MODERATION_ACTION = 'moderation_action',
  USER_WARNING = 'user_warning',
  
  // System
  WELCOME = 'welcome',
  PASSWORD_CHANGED = 'password_changed',
  PROFILE_UPDATED = 'profile_updated',
}

export enum NotificationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

@Entity('notifications')
@Index(['recipientId', 'isRead', 'createdAt'])
@Index(['recipientId', 'type', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  recipientId: string;

  @Column()
  recipientName: string;

  @Column({
    type: 'enum',
    enum: NotificationType,
  })
  type: NotificationType;

  @Column()
  title: string;

  @Column('text')
  message: string;

  @Column({
    type: 'enum',
    enum: NotificationPriority,
    default: NotificationPriority.MEDIUM,
  })
  priority: NotificationPriority;

  @Column('jsonb', { nullable: true })
  metadata: {
    entityId?: string;
    entityType?: string;
    actionUrl?: string;
    actorId?: string;
    actorName?: string;
    actorAvatar?: string;
    department?: string;
    additionalData?: any;
  };

  @Column({ default: false })
  @Index()
  isRead: boolean;

  @Column({ nullable: true })
  readAt?: Date;

  @Column({ default: false })
  isArchived: boolean;

  @Column({ nullable: true })
  archivedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  expiresAt?: Date;

  // Méthodes utilitaires
  markAsRead(): void {
    this.isRead = true;
    this.readAt = new Date();
  }

  archive(): void {
    this.isArchived = true;
    this.archivedAt = new Date();
  }

  isExpired(): boolean {
    if (!this.expiresAt) return false;
    return new Date() > this.expiresAt;
  }
}