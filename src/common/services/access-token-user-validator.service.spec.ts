import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import Redis from 'ioredis';
import { ACCESS_TOKEN_BLACKLIST_KEY_PREFIX } from '../constants/auth.constant';
import { AccessTokenPayload } from '../../modules/auth/dto/auth.dto';
import { UserRole, UserStatus } from '../../modules/users/entities/user.entity';
import { UsersService } from '../../modules/users/users.service';
import { AccessTokenUserValidatorService } from './access-token-user-validator.service';

describe('AccessTokenUserValidatorService', () => {
  let service: AccessTokenUserValidatorService;
  let usersService: { findById: jest.Mock };
  let redis: { exists: jest.Mock };

  const payload: AccessTokenPayload = {
    sub: 'user-1',
    email: 'user@example.com',
    role: UserRole.LEARNER,
    jti: 'token-1',
  };

  beforeEach(() => {
    usersService = { findById: jest.fn() };
    redis = { exists: jest.fn().mockResolvedValue(0) };
    service = new AccessTokenUserValidatorService(
      usersService as unknown as UsersService,
      redis as unknown as Redis,
    );
  });

  it('returns the authenticated user when token and account are valid', async () => {
    usersService.findById.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      role: UserRole.LEARNER,
      status: UserStatus.ACTIVE,
    });

    await expect(service.validate(payload)).resolves.toEqual({
      id: 'user-1',
      email: 'user@example.com',
      role: UserRole.LEARNER,
      status: UserStatus.ACTIVE,
    });
    expect(redis.exists).toHaveBeenCalledWith(
      `${ACCESS_TOKEN_BLACKLIST_KEY_PREFIX}:token-1`,
    );
  });

  it('rejects blacklisted access tokens', async () => {
    redis.exists.mockResolvedValue(1);

    await expect(service.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('rejects missing users', async () => {
    usersService.findById.mockResolvedValue(null);

    await expect(service.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects pending verification users', async () => {
    usersService.findById.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      role: UserRole.LEARNER,
      status: UserStatus.PENDING_VERIFICATION,
    });

    await expect(service.validate(payload)).rejects.toThrow(ForbiddenException);
  });

  it('rejects inactive users', async () => {
    usersService.findById.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      role: UserRole.LEARNER,
      status: UserStatus.INACTIVE,
    });

    await expect(service.validate(payload)).rejects.toThrow(ForbiddenException);
  });
});
