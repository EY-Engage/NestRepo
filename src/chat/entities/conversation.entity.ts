import { Message } from './message.entity';
import { ConversationType } from 'src/shared/enums/conversation-type.enum';
import { Department } from 'src/shared/enums/department.enum';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Participant } from './participant.entity';


@Entity('conversations')
@Index(['type', 'isActive'])
@Index(['department', 'isActive'])
@Index(['creatorId', 'createdAt'])
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: ConversationType,
  })
  @Index()
  type: ConversationType;

  @Column({ nullable: true })
  name?: string;

  @Column('text', { nullable: true })
  description?: string;

  @Column('uuid')
  @Index()
  creatorId: string;

  @Column()
  creatorName: string;

  @Column({ nullable: true })
  creatorProfilePicture?: string;

  @Column({
    type: 'enum',
    enum: Department,
    nullable: true,
  })
  @Index()
  department?: Department;

  @Column({ default: true })
  @Index()
  isActive: boolean;

  @Column({ default: false })
  isPrivate: boolean;

  @Column({ nullable: true })
  @Index()
  lastMessageAt?: Date;

  @Column({ nullable: true })
  lastMessage?: string;

  @Column('uuid', { nullable: true })
  lastMessageById?: string;

  @Column({ nullable: true })
  lastMessageByName?: string;

  @Column({ default: 0 })
  messagesCount: number;

  @Column({ default: 0 })
  participantsCount: number;

  @Column('simple-array', { nullable: true })
  tags?: string[];

  @Column({ nullable: true })
  avatar?: string;

  @Column('jsonb', { nullable: true })
  settings?: {
    allowInvites?: boolean;
    allowFiles?: boolean;
    allowVoiceMessages?: boolean;
    maxParticipants?: number;
    autoDeleteMessages?: boolean;
    autoDeleteAfterDays?: number;
  };

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  archivedAt?: Date;

  @OneToMany(() => Message, message => message.conversation, { cascade: true })
  messages: Message[];

  @OneToMany(() => Participant, participant => participant.conversation, { cascade: true })
  participants: Participant[];
}
