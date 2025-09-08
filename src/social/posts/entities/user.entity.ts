import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Post } from 'src/social/posts/entities/post.entity';
import { Comment } from 'src/social/posts/entities/comment.entity';
import { Reaction } from 'src/social/posts/entities/reaction.entity';
import { Department } from 'src/shared/enums/department.enum';
import { Bookmark } from './bookmark.entity';
import { Role } from 'src/shared/enums/role.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  @Index('IDX_USER_FULL_NAME')
  fullName: string;

  @Column({ unique: true, length: 255 })
  @Index('IDX_USER_EMAIL', { unique: true })
  email: string;
  @Column('simple-array', { default: '' })
  roles: Role[];
  @Column({ nullable: true, length: 500 })
  profilePicture?: string;

  @Column({ length: 100 })
  fonction: string;

  @Column({
    type: 'enum',
    enum: Department,
    default: Department.CONSULTING,
  })
  @Index('IDX_USER_DEPARTMENT')
  department: Department;

  @Column({ length: 100, nullable: true })
  sector?: string;

  @Column({ nullable: true, length: 20 })
  phoneNumber?: string;

  @Column({ default: false })
  @Index('IDX_USER_IS_ACTIVE')
  isActive: boolean;

  @Column({ default: true })
  isFirstLogin: boolean;

  @Column({ nullable: true, length: 1000 })
  refreshToken?: string;

  @Column({ type: 'timestamp', nullable: true })
  refreshTokenExpiry?: Date;

  @Column('uuid', { nullable: true })
  @Index('IDX_USER_SESSION_ID')
  sessionId?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt?: Date;

  // Relations pour le système social
  @OneToMany(() => Post, post => post.authorId)
  posts: Post[];

  @OneToMany(() => Comment, comment => comment.authorId)  
  comments: Comment[];

  @OneToMany(() => Reaction, reaction => reaction.userId)
  reactions: Reaction[];

  // Méthodes utilitaires
  getDisplayName(): string {
    return this.fullName || this.email;
  }

  getProfilePictureUrl(baseUrl?: string): string | null {
    if (!this.profilePicture) return null;
    
    if (this.profilePicture.startsWith('http')) {
      return this.profilePicture;
    }
    
    const base = baseUrl || process.env.BACKEND_URL || '';
    return this.profilePicture.startsWith('/') 
      ? `${base}${this.profilePicture}`
      : `${base}/${this.profilePicture}`;
  }

  isAccountActive(): boolean {
    return this.isActive && !this.isFirstLogin && !this.deletedAt;
  }

  getDepartmentName(): string {
    const departmentNames = {
      [Department.ASSURANCE]: 'Assurance',
      [Department.CONSULTING]: 'Consulting',
      [Department.STRATEGY_AND_TRANSACTIONS]: 'Strategy & Transactions',
      [Department.TAX]: 'Tax',
    };
    return departmentNames[this.department] || 'Consulting';
  }
}