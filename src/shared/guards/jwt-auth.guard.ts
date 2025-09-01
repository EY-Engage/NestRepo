import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromRequest(request);

    if (!token) {
      throw new UnauthorizedException('Token manquant');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('jwt.secret'),
      });

      // Vérifier les claims spécifiques du système .NET Core
      if (!payload.sub || !payload.email) {
        throw new UnauthorizedException('Token invalide - claims manquants');
      }

      // Reconstituer l'objet user depuis le payload JWT avec toutes les propriétés nécessaires
      request.user = {
        id: payload.sub,
        email: payload.email,
        fullName: payload.fullName || payload.name || '',
        isActive: payload.IsActive === 'True' || payload.isActive === true,
        isFirstLogin: payload.IsFirstLogin === 'True' || payload.isFirstLogin === true,
        roles: this.extractRoles(payload),
        department: payload.department || payload.Department,
        profilePicture: payload.profilePicture || payload.ProfilePicture,
        sessionId: payload.SessionId || payload.sessionId,
        fonction: payload.fonction || payload.Fonction || payload.jobTitle,
        sector: payload.sector || payload.Sector,
        phoneNumber: payload.phoneNumber || payload.PhoneNumber,
        createdAt: payload.createdAt || payload.CreatedAt,
        updatedAt: payload.updatedAt || payload.UpdatedAt,
      };

      return true;
    } catch (error) {
      console.error('JWT Validation Error:', error);
      throw new UnauthorizedException('Token invalide ou expiré');
    }
  }

  private extractTokenFromRequest(request: any): string | undefined {
    // D'abord chercher dans les cookies (comme .NET Core)
    const cookieToken = request.cookies?.['ey-session'];
    if (cookieToken) {
      return cookieToken;
    }

    // Puis dans le header Authorization
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  private extractRoles(payload: any): string[] {
    // Les rôles peuvent être dans différents formats selon JWT
    if (payload.role) {
      return Array.isArray(payload.role) ? payload.role : [payload.role];
    }
    
    if (payload.roles) {
      return Array.isArray(payload.roles) ? payload.roles : [payload.roles];
    }
    
    if (payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']) {
      const roles = payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'];
      return Array.isArray(roles) ? roles : [roles];
    }

    // Claims de rôles .NET Core
    const roleClaims = Object.keys(payload).filter(key => 
      key.includes('role') || key.includes('Role')
    );
    
    const extractedRoles: string[] = [];
    roleClaims.forEach(claim => {
      const value = payload[claim];
      if (Array.isArray(value)) {
        extractedRoles.push(...value);
      } else if (typeof value === 'string') {
        extractedRoles.push(value);
      }
    });

    return extractedRoles.length > 0 ? extractedRoles : ['Employee'];
  }
}