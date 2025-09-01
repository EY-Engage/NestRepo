import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ContentType } from 'src/shared/enums/content-type.enum';

export enum FlagStatus {
  PENDING = 'pending',
  UNDER_REVIEW = 'under_review',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

export enum FlagAction {
  NO_ACTION = 'no_action',
  WARNING_SENT = 'warning_sent',
  CONTENT_HIDDEN = 'content_hidden',
  CONTENT_REMOVED = 'content_removed',
  USER_SUSPENDED = 'user_suspended',
  USER_BANNED = 'user_banned',
}

@Entity('flags')
@Index(['targetId', 'targetType'])
@Index(['reportedById', 'createdAt'])
@Index(['status', 'createdAt'])
@Index(['contentAuthorId', 'createdAt'])
@Index(['isUrgent', 'status'])
export class Flag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Informations sur le contenu signalé
  @Column('uuid')
  @Index()
  targetId: string;

  @Column({
    type: 'enum',
    enum: ContentType,
  })
  @Index()
  targetType: ContentType;

  // Informations sur le signalement
  @Column({ length: 200 })
  reason: string;

  @Column('text', { nullable: true })
  description?: string;

  // Informations sur le rapporteur
  @Column('uuid')
  @Index()
  reportedById: string;

  @Column({ length: 100 })
  reportedByName: string;

  @Column({ length: 100 })
  reportedByEmail: string;

  @Column({ length: 50 })
  reportedByDepartment: string;

  // Informations sur l'auteur du contenu signalé
  @Column('uuid')
  @Index()
  contentAuthorId: string;

  @Column({ length: 100 })
  contentAuthorName: string;

  @Column({ length: 50 })
  contentAuthorDepartment: string;

  // Informations sur le contenu
  @Column('text')
  contentSnippet: string; // Extrait du contenu signalé

  @Column('timestamp')
  contentCreatedAt: Date;

  // Gestion du signalement
  @Column({
    type: 'enum',
    enum: FlagStatus,
    default: FlagStatus.PENDING,
  })
  @Index()
  status: FlagStatus;

  @Column({
    type: 'enum',
    enum: FlagAction,
    nullable: true,
  })
  actionTaken?: FlagAction;

  // Informations de modération
  @Column('uuid', { nullable: true })
  @Index()
  reviewedById?: string;

  @Column({ length: 100, nullable: true })
  reviewedByName?: string;

  @Column('timestamp', { nullable: true })
  reviewedAt?: Date;

  @Column('text', { nullable: true })
  moderatorNotes?: string;

  // Métadonnées
  @Column({ default: false })
  @Index()
  isUrgent: boolean;

  @Column({ default: 1 })
  reportCount: number; // Nombre de signalements pour le même contenu

  @Column('text', { nullable: true })
  relatedFlagIds?: string; // JSON string des IDs des signalements similaires

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Méthodes utilitaires
  isExpired(daysThreshold: number = 30): boolean {
    const expirationDate = new Date(this.createdAt);
    expirationDate.setDate(expirationDate.getDate() + daysThreshold);
    return new Date() > expirationDate;
  }

  isPending(): boolean {
    return this.status === FlagStatus.PENDING;
  }

  isUnderReview(): boolean {
    return this.status === FlagStatus.UNDER_REVIEW;
  }

  isResolved(): boolean {
    return this.status === FlagStatus.RESOLVED || this.status === FlagStatus.DISMISSED;
  }

  getContentPreview(maxLength: number = 100): string {
    if (this.contentSnippet.length <= maxLength) {
      return this.contentSnippet;
    }
    return this.contentSnippet.substring(0, maxLength) + '...';
  }

  // Méthodes pour gérer les IDs de signalements liés
  getRelatedFlagIds(): string[] {
    if (!this.relatedFlagIds) return [];
    try {
      return JSON.parse(this.relatedFlagIds);
    } catch {
      return [];
    }
  }

  setRelatedFlagIds(ids: string[]): void {
    this.relatedFlagIds = JSON.stringify(ids);
  }

  addRelatedFlagId(id: string): void {
    const currentIds = this.getRelatedFlagIds();
    if (!currentIds.includes(id)) {
      currentIds.push(id);
      this.setRelatedFlagIds(currentIds);
    }
  }

  // Méthode pour obtenir le type de contenu en français
  getTargetTypeLabel(): string {
    switch (this.targetType) {
      case ContentType.POST:
        return 'Publication';
      case ContentType.COMMENT:
        return 'Commentaire';
      default:
        return 'Contenu';
    }
  }

  // Méthode pour obtenir le statut en français
  getStatusLabel(): string {
    switch (this.status) {
      case FlagStatus.PENDING:
        return 'En attente';
      case FlagStatus.UNDER_REVIEW:
        return 'En cours d\'examen';
      case FlagStatus.RESOLVED:
        return 'Résolu';
      case FlagStatus.DISMISSED:
        return 'Rejeté';
      default:
        return 'Inconnu';
    }
  }

  // Méthode pour obtenir l'action prise en français
  getActionLabel(): string | null {
    if (!this.actionTaken) return null;
    
    switch (this.actionTaken) {
      case FlagAction.NO_ACTION:
        return 'Aucune action';
      case FlagAction.WARNING_SENT:
        return 'Avertissement envoyé';
      case FlagAction.CONTENT_HIDDEN:
        return 'Contenu masqué';
      case FlagAction.CONTENT_REMOVED:
        return 'Contenu supprimé';
      case FlagAction.USER_SUSPENDED:
        return 'Utilisateur suspendu';
      case FlagAction.USER_BANNED:
        return 'Utilisateur banni';
      default:
        return 'Action inconnue';
    }
  }
}