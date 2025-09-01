import { Department } from 'src/shared/enums/department.enum';
import { NotificationType } from 'src/shared/enums/notification-type.enum';
import { Role } from 'src/shared/enums/role.enum';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('notifications')
@Index(['userId', 'createdAt'])
@Index(['type', 'userId'])
@Index(['isRead', 'userId'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: NotificationType,
  })
  @Index()
  type: NotificationType;

  @Column()
  title: string;

  @Column('text')
  content: string;

  @Column('uuid')
  @Index()
  userId: string;

  @Column('uuid', { nullable: true })
  senderId?: string;

  @Column({ nullable: true })
  senderName?: string;

  @Column({ nullable: true })
  senderProfilePicture?: string;

  @Column('uuid', { nullable: true })
  targetId?: string;

  @Column({ nullable: true })
  targetType?: string;

  @Column('jsonb', { nullable: true })
  data?: Record<string, any>;

  @Column({ default: false })
  @Index()
  isRead: boolean;

  @Column({ default: false })
  isDeleted: boolean;

  @Column({
    type: 'enum',
    enum: Department,
    nullable: true,
  })
  departmentFilter?: Department;

  @Column('simple-array', { nullable: true })
  roleFilter?: Role[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  readAt?: Date;

  @Column({ nullable: true })
  expiresAt?: Date;

  @Column({ default: true })
  emailSent: boolean;

  @Column({ default: true })
  pushSent: boolean;

  @Column({ nullable: true })
  actionUrl?: string;

  @Column({ nullable: true })
  category?: string;

  @Column({ default: 'normal' })
  priority: 'low' | 'normal' | 'high' | 'urgent';
}
