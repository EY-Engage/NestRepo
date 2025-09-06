import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { Department } from 'src/shared/enums/department.enum';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          const cookieToken = request?.cookies?.['ey-session'];
          if (cookieToken) {
            return cookieToken;
          }
          return ExtractJwt.fromAuthHeaderAsBearerToken()(request);
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Payload JWT invalide');
    }

    // Extraction correcte du profilePicture depuis différents formats possibles
    const profilePicture = this.extractProfilePicture(payload);
    const department = this.extractDepartment(payload);
    const roles = this.extractRoles(payload);
    
    return {
      id: payload.sub,
      email: payload.email,
      fullName: payload.fullName || payload.FullName || payload.name || '',
      profilePicture: profilePicture,
      fonction: payload.fonction || payload.Fonction || payload.jobTitle || '',
      sector: payload.sector || payload.Sector || '',
      phoneNumber: payload.phoneNumber || payload.PhoneNumber || '',
      isActive: payload.IsActive === 'True' || payload.isActive === true || payload.active === true,
      isFirstLogin: payload.IsFirstLogin === 'True' || payload.isFirstLogin === true || payload.firstLogin === true,
      roles: roles,
      department: department,
      sessionId: payload.SessionId || payload.sessionId || payload.session_id,
      createdAt: new Date(payload.createdAt || payload.CreatedAt || Date.now()),
      updatedAt: new Date(payload.updatedAt || payload.UpdatedAt || Date.now()),
    };
  }

private extractProfilePicture(payload: any): string | null {
  // Gestion de différents formats possibles du profilePicture
  const profilePic = payload.profilePicture ||
                     payload.ProfilePicture ||
                     payload.profile_picture ||
                     payload.picture ||
                     payload.avatar;

  console.log('Profile picture extracted from JWT:', profilePic); // Debug
  return profilePic || null;
}

  private extractDepartment(payload: any): Department {
    // Gestion de différents formats possibles du département
    const dept = payload.department || 
                 payload.Department || 
                 payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/department'];
    
    if (!dept) {
      console.warn('Department not found in JWT payload');
      return Department.CONSULTING; // Valeur par défaut
    }

    // Conversion du format .NET vers l'enum TypeScript
    const departmentMap: { [key: string]: Department } = {
      'Assurance': Department.ASSURANCE,
      'Consulting': Department.CONSULTING,
      'StrategyAndTransactions': Department.STRATEGY_AND_TRANSACTIONS,
      'Tax': Department.TAX,
      'ASSURANCE': Department.ASSURANCE,
      'CONSULTING': Department.CONSULTING,
      'STRATEGY_AND_TRANSACTIONS': Department.STRATEGY_AND_TRANSACTIONS,
      'TAX': Department.TAX
    };

    return departmentMap[dept] || Department.CONSULTING;
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