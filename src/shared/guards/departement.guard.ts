import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Role } from '../enums/role.enum';

@Injectable()
export class DepartmentGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const targetDepartment = request.params.department || request.query.department;

    if (!user) {
      return false;
    }

    // SuperAdmin et Admin peuvent accéder à tous les départements
    if (user.roles.includes(Role.SUPER_ADMIN) || user.roles.includes(Role.ADMIN)) {
      return true;
    }

    // AgentEY peut seulement accéder à son département
    if (user.roles.includes(Role.AGENT_EY)) {
      return !targetDepartment || user.department === targetDepartment;
    }

    // EmployeeEY peut voir son département et les posts publics
    return true;
  }
}