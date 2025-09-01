import { ContentType } from 'src/shared/enums/content-type.enum';
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
import { Post } from './post.entity';
import { Comment } from './comment.entity';

@Entity('reactions')
@Unique(['userId', 'targetId', 'targetType'])
@Index(['targetId', 'targetType'])
@Index(['userId', 'createdAt'])
export class Reaction {
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
  targetId: string;

  @Column({
    type: 'enum',
    enum: ContentType,
  })
  @Index()
  targetType: ContentType;

  @CreateDateColumn()
  createdAt: Date;

  // Supprimez les relations conditionnelles et créez une relation générique
  // Au lieu de cela, validez la cible dans le service
}