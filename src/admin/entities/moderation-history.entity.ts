// entities/moderation-history.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ContentType } from 'src/shared/enums/content-type.enum';
import { FlagAction } from 'src/social/posts/entities/flag.entity';
@Entity('moderation_history')
@Index(['targetId', 'targetType'])
@Index(['moderatorId', 'resolvedAt'])
@Index(['contentAuthorId', 'resolvedAt'])
export class ModerationHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  targetId: string;

  @Column({
    type: 'enum',
    enum: ContentType,
  })
  targetType: ContentType;

  @Column({
    type: 'enum',
    enum: FlagAction,
  })
  action: FlagAction;

  @Column('text', { nullable: true })
  reason?: string;

  @Column('uuid')
  @Index()
  moderatorId: string;

  @Column()
  moderatorName: string;

  @Column('uuid')
  @Index()
  contentAuthorId: string;

  @Column()
  contentAuthorName: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  resolvedAt?: Date;
}