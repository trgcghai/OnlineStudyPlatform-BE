import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import { AuthController } from './auth.controller';

describe('AuthController rate limiting', () => {
  const handlerOf = (methodName: keyof AuthController): object =>
    Object.getOwnPropertyDescriptor(AuthController.prototype, methodName)!
      .value as object;

  const expectThrottle = (
    methodName: keyof AuthController,
    limit: number,
    ttl: number,
  ) => {
    const handler = handlerOf(methodName);
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBe(
      limit,
    );
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(ttl);
  };

  it('limits login and register', () => {
    expectThrottle('login', 10, 60_000);
    expectThrottle('register', 5, 60_000);
  });

  it('limits email verification OTP endpoints', () => {
    expectThrottle('resendEmailOtp', 5, 3_600_000);
    expectThrottle('verifyEmail', 10, 60_000);
  });

  it('limits password reset endpoints', () => {
    expectThrottle('requestPasswordResetOtp', 5, 3_600_000);
    expectThrottle('verifyPasswordResetOtp', 10, 60_000);
    expectThrottle('resetPassword', 5, 60_000);
  });

  it('limits refresh and logout', () => {
    expectThrottle('refresh', 30, 60_000);
    expectThrottle('logout', 30, 60_000);
  });
});
