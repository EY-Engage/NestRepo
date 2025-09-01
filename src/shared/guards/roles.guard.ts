import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../enums/role.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // Pas de rôles requis
    }

    const { user } = context.switchToHttp().getRequest();
    
    if (!user || !user.roles || !Array.isArray(user.roles)) {
      console.log('RolesGuard: Utilisateur ou rôles manquants', { user: user?.id, roles: user?.roles });
      return false;
    }

    // SuperAdmin a accès à tout SAUF si explicitement exclu
    if (user.roles.includes(Role.SUPER_ADMIN) && !this.isSuperAdminExcluded(requiredRoles)) {
      return true;
    }

    // Vérifier si l'utilisateur a au moins un des rôles requis
    const hasRequiredRole = requiredRoles.some((role) => user.roles.includes(role));
    
    if (!hasRequiredRole) {
      console.log('RolesGuard: Accès refusé', { 
        userId: user.id, 
        userRoles: user.roles, 
        requiredRoles 
      });
    }

    return hasRequiredRole;
  }

  private isSuperAdminExcluded(requiredRoles: Role[]): boolean {
    // Si les rôles requis excluent explicitement SuperAdmin
    return requiredRoles.includes(Role.ADMIN) && 
           requiredRoles.includes(Role.AGENT_EY) && 
           !requiredRoles.includes(Role.SUPER_ADMIN);
  }
}