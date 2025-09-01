import { Department } from 'src/shared/enums/department.enum';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Reaction } from './reaction.entity';
import { Comment } from './comment.entity';
import { Bookmark } from './bookmark.entity';

@Entity('posts')
@Index(['authorId', 'createdAt'])
@Index(['departmentOnly', 'authorDepartment'])
@Index(['isPublic', 'createdAt'])
export class Post {
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
  @Index()
  authorDepartment: Department;

  @Column('simple-array', { nullable: true })
  images?: string[];

  @Column('simple-array', { nullable: true })
  files?: string[];

  @Column({
    type: 'text',
    array: true,
    nullable: true,
    default: () => "'{}'"
  })
  tags?: string[];

  @Column('simple-array', { nullable: true })
  mentions?: string[];

  @Column({ default: true })
  @Index()
  isPublic: boolean;

  @Column({ default: false })
  @Index()
  departmentOnly: boolean;

  @Column({ default: true })
  allowComments: boolean;

  @Column({ default: true })
  allowShares: boolean;

  @Column({ default: false })
  isPinned: boolean;

  @Column({ default: false })
  isEdited: boolean;

  @Column('uuid', { nullable: true })
  originalPostId?: string;

  @Column({ nullable: true })
  originalAuthorName?: string;

  @Column({ default: 0 })
  likesCount: number;

  @Column({ default: 0 })
  commentsCount: number;

  @Column({ default: 0 })
  sharesCount: number;

  @Column({ default: 0 })
  viewsCount: number;

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

  // Relations
  @OneToMany(() => Reaction, reaction => reaction.targetId, {
    cascade: true
  })
  reactions: Reaction[];

  @OneToMany(() => Comment, comment => comment.post, { cascade: true })
  comments: Comment[];

   @OneToMany(() => Post, post => post.originalPost)
  shares: Post[];

  @ManyToOne(() => Post, post => post.shares, { 
    nullable: true,
    onDelete: 'SET NULL' 
  })
  @JoinColumn({ name: 'originalPostId' })
  originalPost: Post;
  @OneToMany(() => Bookmark, bookmark => bookmark.post)
bookmarks: Bookmark[];
}