import { Department } from 'src/shared/enums/department.enum';
import { MessageType } from 'src/shared/enums/message-type.enum';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Conversation } from './conversation.entity';
import { MessageReaction } from './message-reaction.entity';
import { Reaction } from 'src/social/posts/entities/reaction.entity';

@Entity('messages')
@Index(['conversationId', 'createdAt'])
@Index(['senderId', 'createdAt'])
@Index(['replyToId', 'createdAt'])
@Index(['isDeleted', 'createdAt'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  conversationId: string;

  @Column('uuid')
  @Index()
  senderId: string;

  @Column()
  senderName: string;

  @Column({ nullable: true })
  senderProfilePicture?: string;

  @Column({
    type: 'enum',
    enum: Department,
  })
  senderDepartment: Department;

  @Column({
    type: 'enum',
    enum: MessageType,
  })
  @Index()
  type: MessageType;

  @Column('text')
  content: string;

  @Column('simple-array', { nullable: true })
  attachments?: string[];

  @Column('simple-array', { nullable: true })
  mentions?: string[];

  @Column('uuid', { nullable: true })
  @Index()
  replyToId?: string;

  @Column({ nullable: true })
  replyToContent?: string;

  @Column({ nullable: true })
  replyToSenderName?: string;

  @Column({ default: false })
  isEdited: boolean;

  @Column({ default: false })
  @Index()
  isDeleted: boolean;

  @Column({ default: false })
  isSystem: boolean;

  @Column({ default: false })
  isPinned: boolean;

  @Column({ default: 0 })
  reactionsCount: number;

  @Column('jsonb', { nullable: true })
  metadata?: {
    fileSize?: number;
    fileName?: string;
    mimeType?: string;
    duration?: number; // Pour les messages audio/vidéo
    coordinates?: { lat: number; lng: number }; // Pour la géolocalisation
    link?: { title: string; description: string; image: string; url: string }; // Pour les liens
  };

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  deletedAt?: Date;

  @Column('uuid', { nullable: true })
  deletedById?: string;

  @ManyToOne(() => Conversation, conversation => conversation.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation: Conversation;

  @ManyToOne(() => Message, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'replyToId' })
  replyToMessage?: Message;


  @OneToMany(() => MessageReaction, reaction => reaction.message, { cascade: true })
  reactions: MessageReaction[];


  // Statut de lecture (géré séparément pour les performances)
  readBy?: {
    userId: string;
    userName: string;
    readAt: Date;
  }[];
}
