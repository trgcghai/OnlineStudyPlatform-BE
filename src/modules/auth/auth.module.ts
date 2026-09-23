import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { EmailDeliveryService } from './email-delivery.service';
import { EmailVerificationService } from './email-verification.service';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { JwtStrategy } from '../../common/strategies/jwt.strategy';

@Module({
  imports: [UsersModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    EmailDeliveryService,
    EmailVerificationService,
    PasswordResetService,
    JwtStrategy,
  ],
})
export class AuthModule {}
