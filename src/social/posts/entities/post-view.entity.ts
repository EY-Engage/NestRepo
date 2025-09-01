import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
  Index,
} from 'typeorm';

@Entity('post_views')
@Unique(['postId', 'userId'])
@Index(['postId', 'createdAt'])
@Index(['userId', 'createdAt'])
export class PostView {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  postId: string;

  @Column('uuid')
  @Index()
  userId: string;

  @Column()
  userName: string;

  @Column({ nullable: true })
  userDepartment?: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  duration?: number; // Durée de visualisation en secondes

  @Column({ default: false })
  isInteraction: boolean; // Si l'utilisateur a interagi (like, comment, etc.)
}