import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import Redis from 'ioredis';
import { ACCESS_TOKEN_BLACKLIST_KEY_PREFIX } from '../constants/auth.constant';
import {
  AccessTokenPayload,
  AuthenticatedUser,
} from '../../modules/auth/dto/auth.dto';
import { REDIS_CLIENT } from '../../modules/redis/redis.module';
import { UserStatus } from '../../modules/users/entities/user.entity';
import { UsersService } from '../../modules/users/users.service';

@Injectable()
export class AccessTokenUserValidatorService {
  constructor(
    private readonly usersService: UsersService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    if (payload.jti) {
      const blacklisted = await this.redis.exists(
        `${ACCESS_TOKEN_BLACKLIST_KEY_PREFIX}:${payload.jti}`,
      );

      if (blacklisted) {
        throw new UnauthorizedException();
      }
    }

    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException();
    }

    if (user.status === UserStatus.PENDING_VERIFICATION) {
      throw new ForbiddenException('Email verification required');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Account disabled');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    };
  }
}
