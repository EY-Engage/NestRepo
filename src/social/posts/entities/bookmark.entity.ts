import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { Post } from './post.entity';
import { User } from './user.entity';

@Entity('bookmarks')
@Index(['userId', 'postId'], { unique: true }) // Un utilisateur ne peut bookmarker qu'une fois le même post
export class Bookmark {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  userId: string;

  @Column('uuid')
  @Index()
  postId: string;

  @CreateDateColumn()
  createdAt: Date;

  // Relations

@ManyToOne(() => Post, post => post.bookmarks, { onDelete: 'CASCADE' })
@JoinColumn({ name: 'postId' })
post: Post;
}