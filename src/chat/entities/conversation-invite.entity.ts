import { Department } from 'src/shared/enums/department.enum';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('conversation_invites')
@Index(['conversationId', 'status'])
@Index(['invitedUserId', 'status'])
@Index(['createdAt'])
export class ConversationInvite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  conversationId: string;

  @Column()
  conversationName: string;

  @Column('uuid')
  @Index()
  invitedUserId: string;

  @Column()
  invitedUserName: string;

  @Column()
  invitedUserEmail: string;

  @Column('uuid')
  invitedById: string;

  @Column()
  invitedByName: string;

  @Column({
    type: 'enum',
    enum: Department,
  })
  invitedByDepartment: Department;

  @Column({
    type: 'enum',
    enum: ['pending', 'accepted', 'declined', 'expired'],
    default: 'pending',
  })
  @Index()
  status: 'pending' | 'accepted' | 'declined' | 'expired';

  @Column('text', { nullable: true })
  message?: string;

  @Column({ nullable: true })
  expiresAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  respondedAt?: Date;
}