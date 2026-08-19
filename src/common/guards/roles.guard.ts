import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../constants/auth.constant';
import { UserRole } from '../../modules/users/entities/user.entity';
import { AuthenticatedRequest } from 'src/modules/auth/dto/auth.dto';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!roles) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();

    if (!request.user) {
      throw new UnauthorizedException();
    }

    if (roles.includes(request.user.role)) {
      return true;
    }

    throw new ForbiddenException();
  }
}
