import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
  Index,
} from 'typeorm';

@Entity('message_status')
@Unique(['messageId', 'userId'])
@Index(['messageId', 'status'])
@Index(['userId', 'readAt'])
export class MessageStatus {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  messageId: string;

  @Column('uuid')
  @Index()
  userId: string;

  @Column()
  userName: string;

  @Column({
    type: 'enum',
    enum: ['sent', 'delivered', 'read'],
    default: 'sent',
  })
  @Index()
  status: 'sent' | 'delivered' | 'read';

  @CreateDateColumn()
  deliveredAt: Date;

  @Column({ nullable: true })
  readAt?: Date;
}
