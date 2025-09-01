import { Controller, Post, Body, Logger } from '@nestjs/common';
import { IntegrationService } from './integration.service';

export class UserCreatedNotification {
  id: string;
  fullName: string;
  email: string;
  profilePicture?: string;
  phoneNumber?: string;
  fonction: string;
  department: string;
  sector: string;
  isActive: boolean;
  isFirstLogin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class UserActivatedNotification {
  userId: string;
  isActive: boolean;
  isFirstLogin: boolean;
  activatedAt: Date;
}

export class SocialActivityNotification {
  userId: string;
  activityType: string;
  targetId: string;
  details: Record<string, any>;
}

@Controller('integration')
export class IntegrationController {
  private readonly logger = new Logger(IntegrationController.name);

  constructor(private readonly integrationService: IntegrationService) {}

  @Post('user-created')
  async handleUserCreated(@Body() notification: UserCreatedNotification) {
    try {
      this.logger.log(`Received user created notification for: ${notification.email}`);
      
      // Ici on peut traiter la notification, par exemple :
      // - Créer un profil social par défaut
      // - Initialiser des paramètres de notification
      // - Envoyer des suggestions de follow
      
      this.logger.log(`Successfully processed user created notification for: ${notification.id}`);
      
      return { success: true, message: 'User created notification processed' };
    } catch (error) {
      this.logger.error(`Error processing user created notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post('user-activated')
  async handleUserActivated(@Body() notification: UserActivatedNotification) {
    try {
      this.logger.log(`Received user activated notification for: ${notification.userId}`);
      
      // Traiter l'activation utilisateur :
      // - Envoyer des notifications de bienvenue
      // - Activer les fonctionnalités sociales
      // - Proposer des connexions initiales
      
      this.logger.log(`Successfully processed user activated notification for: ${notification.userId}`);
      
      return { success: true, message: 'User activated notification processed' };
    } catch (error) {
      this.logger.error(`Error processing user activated notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post('social-activity')
  async handleSocialActivity(@Body() notification: SocialActivityNotification) {
    try {
      this.logger.log(`Received social activity notification: ${notification.activityType} by user ${notification.userId}`);
      
      // Traiter l'activité sociale :
      // - Créer des notifications
      // - Mettre à jour les scores d'engagement
      // - Déclencher des algorithmes de recommandation
      
      this.logger.log(`Successfully processed social activity notification: ${notification.activityType}`);
      
      return { success: true, message: 'Social activity notification processed' };
    } catch (error) {
      this.logger.error(`Error processing social activity notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  // Endpoint de health check pour .NET
  @Post('health')
  async healthCheck() {
    return {
      status: 'healthy',
      timestamp: new Date(),
      service: 'nestjs-social'
    };
  }
}