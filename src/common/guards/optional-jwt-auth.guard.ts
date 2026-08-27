import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JWT_STRATEGY_NAME } from '../constants/auth.constant';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard(JWT_STRATEGY_NAME) {
  canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<{ headers?: { authorization?: string } }>();
    const authorization = request.headers?.authorization;

    if (!authorization) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(
    _error: unknown,
    user: TUser | false | null,
  ): TUser | null {
    return user || null;
  }
}
