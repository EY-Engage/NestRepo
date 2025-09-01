import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { WsException } from '@nestjs/websockets';

@Injectable()
export class WsAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient();
    const token = this.extractTokenFromSocket(client);

    if (!token) {
      throw new WsException('Token manquant');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('jwt.secret'),
      });

      client.user = {
        id: payload.sub,
        email: payload.email,
        fullName: payload.fullName || '',
        isActive: payload.IsActive === 'True',
        isFirstLogin: payload.IsFirstLogin === 'True',
        roles: this.extractRoles(payload),
        department: payload.department,
        sessionId: payload.SessionId,
      };

      return true;
    } catch (error) {
      throw new WsException('Token invalide ou expiré');
    }
  }

  private extractTokenFromSocket(client: any): string | undefined {
    // Token peut être dans l'auth ou dans les cookies
    const token = client.handshake?.auth?.token || 
                  client.handshake?.headers?.cookie?.match(/ey-session=([^;]+)/)?.[1];
    
    return token;
  }

  private extractRoles(payload: any): string[] {
    if (payload.role) {
      return Array.isArray(payload.role) ? payload.role : [payload.role];
    }
    
    if (payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']) {
      const roles = payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'];
      return Array.isArray(roles) ? roles : [roles];
    }

    return [];
  }
}