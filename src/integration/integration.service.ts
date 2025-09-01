import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface UserPublicProfile {
  id: string;
  fullName: string;
  email: string;
  profilePicture?: string;
  phoneNumber?: string;
  fonction?: string;
  department: string;
  sector?: string;
  isActive: boolean;
  roles?: string[];
}

export interface SocialActivityNotification {
  userId: string;
  activityType: 'POST_CREATED' | 'POST_LIKED' | 'POST_COMMENTED' | 'USER_FOLLOWED';
  targetId: string;
  details: any;
}

@Injectable()
export class IntegrationService {
  private readonly logger = new Logger(IntegrationService.name);
  private readonly dotnetBaseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.dotnetBaseUrl = this.configService.get<string>('DOTNET_API_URL') || 'http://localhost:5058';
  }

  // Récupérer un utilisateur depuis .NET
  async getUserFromDotNet(userId: string, authToken?: string): Promise<UserPublicProfile | null> {
    try {
      const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
      
      const response = await firstValueFrom(
        this.httpService.get(`${this.dotnetBaseUrl}/api/user/public/${userId}`, { headers })
      );
      
      const dotnetUser = response.data;
      
      return {
        id: dotnetUser.id,
        fullName: dotnetUser.fullName,
        email: dotnetUser.email,
        profilePicture: dotnetUser.profilePicture,
        phoneNumber: dotnetUser.phoneNumber,
        fonction: dotnetUser.fonction,
        department: dotnetUser.department,
        sector: dotnetUser.sector,
        isActive: dotnetUser.isActive,
        roles: dotnetUser.roles
      };
    } catch (error) {
      this.logger.error(`Erreur récupération utilisateur ${userId} depuis .NET:`, error.message);
      return null;
    }
  }

  // Récupérer plusieurs utilisateurs
  async getUsersFromDotNet(userIds: string[], authToken?: string): Promise<UserPublicProfile[]> {
    const users = await Promise.allSettled(
      userIds.map(id => this.getUserFromDotNet(id, authToken))
    );
    
    return users
      .filter(result => result.status === 'fulfilled' && result.value !== null)
      .map(result => (result as PromiseFulfilledResult<UserPublicProfile>).value);
  }

  // Notifier .NET d'une activité sociale
  async notifyDotNetOfSocialActivity(activity: SocialActivityNotification): Promise<void> {
    try {
      await firstValueFrom(
        this.httpService.post(`${this.dotnetBaseUrl}/api/integration/social-activity`, activity)
      );
    } catch (error) {
      this.logger.warn('Erreur notification .NET:', error.message);
      // Ne pas faire échouer la requête principale si la notification échoue
    }
  }

  // Valider un token JWT avec .NET
  async validateTokenWithDotNet(token: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.dotnetBaseUrl}/api/auth/validate-token`, { token })
      );
      return response.data;
    } catch (error) {
      throw new HttpException('Token invalide', HttpStatus.UNAUTHORIZED);
    }
  }
}
