import { Message } from 'src/chat/entities/message.entity';
import { Department } from 'src/shared/enums/department.enum';
import { ReactionType } from 'src/shared/enums/reaction-type.enum';
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

@Entity('message_reactions')
@Unique(['messageId', 'userId'])
@Index(['messageId', 'type'])
@Index(['userId', 'createdAt'])
export class MessageReaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: ReactionType,
  })
  type: ReactionType;

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

  @Column('uuid')
  @Index()
  messageId: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Message, message => message.reactions, { 
    onDelete: 'CASCADE' 
  })
  @JoinColumn({ 
    name: 'messageId',
    foreignKeyConstraintName: 'FK_message_reactions_message' 
  })
  message: Message;
}