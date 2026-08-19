import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JWT_STRATEGY_NAME } from 'src/common/constants/auth.constant';
import {
  AccessTokenPayload,
  AuthenticatedUser,
} from 'src/modules/auth/dto/auth.dto';
import { UserStatus } from 'src/modules/users/entities/user.entity';
import { UsersService } from 'src/modules/users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_STRATEGY_NAME) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException();
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
