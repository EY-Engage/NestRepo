import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { Conversation } from './conversation.entity';
import { Department } from 'src/shared/enums/department.enum';

@Entity('participants')
@Unique(['conversationId', 'userId'])
@Index(['conversationId', 'isActive'])
@Index(['userId', 'isActive'])
export class Participant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  conversationId: string;

  @Column('uuid')
  @Index()
  userId: string;

  @Column()
  userName: string;

  @Column({ nullable: true })
  userProfilePicture?: string;

  @Column({
    type: 'enum',
    enum: Department,
  })
  userDepartment: Department;

  @Column({
    type: 'enum',
    enum: ['owner', 'admin', 'member'],
    default: 'member',
  })
  @Index()
  role: 'owner' | 'admin' | 'member';

  @Column({ default: true })
  @Index()
  isActive: boolean;

  @Column({ default: false })
  isMuted: boolean;

  @Column({ nullable: true })
  mutedUntil?: Date;

  @Column({ default: true })
  canSendMessages: boolean;

  @Column({ default: true })
  canAddParticipants: boolean;

  @Column({ default: false })
  canDeleteMessages: boolean;

  @Column({ nullable: true })
  nickname?: string;

  @CreateDateColumn()
  joinedAt: Date;

  @Column({ nullable: true })
  @Index()
  lastSeenAt?: Date;

  @Column({ nullable: true })
  lastMessageReadId?: string;

  @Column({ default: 0 })
  unreadCount: number;

  @Column({ nullable: true })
  leftAt?: Date;

  @Column('uuid', { nullable: true })
  invitedById?: string;

  @Column({ nullable: true })
  invitedByName?: string;

  @ManyToOne(() => Conversation, conversation => conversation.participants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation: Conversation;
}