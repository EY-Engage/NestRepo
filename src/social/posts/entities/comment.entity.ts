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
import { Department } from '../../../shared/enums/department.enum';
import { Post } from './post.entity';
import { Reaction } from './reaction.entity';

@Entity('comments')
@Index(['postId', 'createdAt'])
@Index(['authorId', 'createdAt'])
@Index(['parentCommentId', 'createdAt'])
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('text')
  content: string;

  @Column('uuid')
  @Index()
  authorId: string;

  @Column()
  authorName: string;

  @Column({ nullable: true })
  authorProfilePicture?: string;

  @Column({
    type: 'enum',
    enum: Department,
  })
  authorDepartment: Department;

  @Column('uuid')
  @Index()
  postId: string;

  @Column('uuid', { nullable: true })
  @Index()
  parentCommentId?: string;

  @Column('simple-array', { nullable: true })
  mentions?: string[];

  @Column('simple-array', { nullable: true })
  attachments?: string[];

  @Column({ default: false })
  isEdited: boolean;

  @Column({ default: 0 })
  likesCount: number;

  @Column({ default: 0 })
  repliesCount: number;

  @Column({ default: false })
  isFlagged: boolean;

  @Column({ nullable: true })
  flagReason?: string;

  @Column('uuid', { nullable: true })
  flaggedById?: string;

  @Column({ nullable: true })
  flaggedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  deletedAt?: Date;

  // Relation avec Post
  @ManyToOne(() => Post, post => post.comments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post: Post;

  // Relation avec le commentaire parent
  @ManyToOne(() => Comment, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parentCommentId' })
  parentComment?: Comment;

  // Relation avec les réponses
  @OneToMany(() => Comment, comment => comment.parentComment)
  replies: Comment[];
}