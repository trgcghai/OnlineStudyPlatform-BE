import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { UsersService } from './users.service';
import {
  ChangePasswordDto,
  CreateUserDto,
  UpdateProfileDto,
} from './dto/user.dto';
import { User, UserRole, UserStatus } from './entities/user.entity';

describe('UsersService', () => {
  let service: UsersService;
  let repo: { create: jest.Mock; findOneBy: jest.Mock; save: jest.Mock };
  let minioClient: { putObject: jest.Mock; removeObject: jest.Mock };
  let configService: { getOrThrow: jest.Mock };

  const makeUser = (): User => ({
    id: 'b7f8c2a0-1111-4a11-9f0a-000000000001',
    name: 'Nguyen Van A',
    email: 'test@example.com',
    password: '$2b$10$abcdefghijklmnopqrstuv',
    role: UserRole.LEARNER,
    status: UserStatus.ACTIVE,
    avatar: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });

  const userId = 'b7f8c2a0-1111-4a11-9f0a-000000000001';

  const dto: CreateUserDto = {
    name: '  Nguyen Van A  ',
    email: '  Test@Example.COM ',
    password: 'abcd1234!',
  };

  beforeEach(() => {
    repo = {
      create: jest.fn((input: Partial<User>) => input),
      findOneBy: jest.fn().mockResolvedValue(null),
      save: jest.fn((input: Partial<User>) => ({
        ...makeUser(),
        ...input,
      })),
    };
    minioClient = {
      putObject: jest.fn().mockResolvedValue({ etag: '"etag"' }),
      removeObject: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'MINIO_BUCKET') return 'lms-bucket';
        if (key === 'MINIO_ENDPOINT') return 'http://localhost:9000';
        return undefined;
      }),
    };
    service = new UsersService(
      repo as unknown as Repository<User>,
      configService as unknown as ConfigService,
      minioClient as never,
    );
  });

  it('hashes the password before saving and returns the saved user', async () => {
    const saved = makeUser();
    repo.save.mockResolvedValue(saved);

    const result = await service.create(dto);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Nguyen Van A',
        email: 'test@example.com',
        password: expect.stringMatching(/^\$2[ab]\$\d+\$/),
      }),
    );
    const savedInput = repo.create.mock.calls[0][0] as User;
    expect(savedInput.password).not.toBe(dto.password);
    expect(result).toEqual({
      id: saved.id,
      name: saved.name,
      email: saved.email,
      role: saved.role,
      avatar: saved.avatar,
      status: saved.status,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    });
  });

  it('normalizes email (trim + lowercase) and trims the name', async () => {
    repo.save.mockResolvedValue({});

    await service.create(dto);

    const savedInput = repo.create.mock.calls[0][0] as User;
    expect(savedInput.email).toBe('test@example.com');
    expect(savedInput.name).toBe('Nguyen Van A');
  });

  it('findByEmail normalizes input email before repository lookup', async () => {
    await service.findByEmail('  USER@Example.COM  ');

    expect(repo.findOneBy).toHaveBeenCalledWith({ email: 'user@example.com' });
  });

  it('findById looks up by id', async () => {
    await service.findById('user-id');

    expect(repo.findOneBy).toHaveBeenCalledWith({ id: 'user-id' });
  });

  it('rejects an existing email with ConflictException', async () => {
    repo.findOneBy.mockResolvedValue({ id: 'existing-user-id' });

    await expect(service.create(dto)).rejects.toEqual(
      new ConflictException('Email already registered'),
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects a database unique email violation with ConflictException', async () => {
    repo.save.mockRejectedValue({ code: '23505' });

    await expect(service.create(dto)).rejects.toEqual(
      new ConflictException('Email already registered'),
    );
  });

  it('wraps unrelated database errors in a generic InternalServerErrorException', async () => {
    const error = new Error('connection reset');
    repo.save.mockRejectedValue(error);

    await expect(service.create(dto)).rejects.toEqual(
      new InternalServerErrorException('Could not create user'),
    );
  });

  describe('getProfile', () => {
    it('returns the safe user response without the password hash', async () => {
      const user = makeUser();
      repo.findOneBy.mockResolvedValue(user);

      const result = await service.getProfile(userId);

      expect(repo.findOneBy).toHaveBeenCalledWith({ id: userId });
      expect(result).not.toHaveProperty('password');
      expect(result).toMatchObject({ id: userId, name: user.name });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      await expect(service.getProfile('missing-id')).rejects.toEqual(
        new NotFoundException('User not found'),
      );
    });
  });

  describe('updateProfile', () => {
    const updateDto: UpdateProfileDto = {
      name: '  New Name  ',
    };

    it('updates the name and returns the safe response', async () => {
      repo.findOneBy.mockResolvedValueOnce(makeUser());

      const result = await service.updateProfile(userId, updateDto);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Name' }),
      );
      expect(result).toMatchObject({
        name: 'New Name',
        email: makeUser().email,
      });
      expect(result).not.toHaveProperty('password');
    });

    it('keeps current values when no fields are provided (no-op)', async () => {
      repo.findOneBy.mockResolvedValue(makeUser());

      const result = await service.updateProfile(userId, {});

      expect(repo.save).not.toHaveBeenCalled();
      expect(result).toMatchObject({ name: makeUser().name });
    });

    it('never changes the email even if a value is provided', async () => {
      repo.findOneBy.mockResolvedValue(makeUser());

      const result = await service.updateProfile(userId, {
        name: 'New Name',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Name',
          email: makeUser().email,
        }),
      );
      expect(result.email).toBe(makeUser().email);
    });

    it('throws NotFoundException when the user does not exist', async () => {
      await expect(
        service.updateProfile('missing-id', updateDto),
      ).rejects.toEqual(new NotFoundException('User not found'));
    });
  });

  describe('changePassword', () => {
    const changeDto: ChangePasswordDto = {
      currentPassword: 'OldPass@123',
      newPassword: 'NewPass@456',
    };

    it('rejects a wrong current password and keeps the old hash', async () => {
      repo.findOneBy.mockResolvedValue(makeUser());

      await expect(service.changePassword(userId, changeDto)).rejects.toEqual(
        new BadRequestException('Current password is incorrect'),
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('hashes and saves the new password on success', async () => {
      const hashedOld = await bcrypt.hash('OldPass@123', 10);
      repo.findOneBy.mockResolvedValue({
        ...makeUser(),
        password: hashedOld,
      });

      await service.changePassword(userId, changeDto);

      const savedInput = repo.save.mock.calls[0][0] as User;
      expect(savedInput.password).not.toBe(hashedOld);
      expect(savedInput.password).toMatch(/^\$2[ab]\$\d+\$/);
      await expect(
        bcrypt.compare(changeDto.newPassword, savedInput.password),
      ).resolves.toBe(true);
    });

    it('throws NotFoundException when the user does not exist', async () => {
      await expect(
        service.changePassword('missing-id', changeDto),
      ).rejects.toEqual(new NotFoundException('User not found'));
    });
  });

  describe('uploadAvatar', () => {
    const pngFile: Express.Multer.File = {
      fieldname: 'avatar',
      originalname: 'me.PNG',
      encoding: '7bit',
      mimetype: 'image/png',
      size: 4,
      buffer: Buffer.from('png!'),
      stream: undefined as never,
      destination: '',
      filename: '',
      path: '',
    };

    it('uploads to MinIO under avatars/{userId}/ and stores the public URL', async () => {
      repo.findOneBy.mockResolvedValue(makeUser());

      const result = await service.uploadAvatar(userId, pngFile);

      expect(minioClient.putObject).toHaveBeenCalledWith(
        'lms-bucket',
        expect.stringMatching(/^avatars\/b7f8c2a0-.+\.png$/),
        pngFile.buffer,
        pngFile.size,
        { contentType: 'image/png' },
      );
      const publicUrl = result.avatar as string;
      expect(publicUrl).toMatch(
        /^http:\/\/localhost:9000\/lms-bucket\/avatars\//,
      );
      expect(publicUrl.endsWith('.png')).toBe(true);
    });

    it('removes the previous avatar object best-effort when replacing one', async () => {
      repo.findOneBy.mockResolvedValue({
        ...makeUser(),
        avatar: 'http://localhost:9000/lms-bucket/avatars/old.jpg',
      });

      await service.uploadAvatar(userId, pngFile);

      expect(minioClient.removeObject).toHaveBeenCalledWith(
        'lms-bucket',
        'avatars/old.jpg',
      );
    });

    it('still succeeds when removing the old object fails', async () => {
      repo.findOneBy.mockResolvedValue({
        ...makeUser(),
        avatar: 'http://localhost:9000/lms-bucket/avatars/old.jpg',
      });
      minioClient.removeObject.mockRejectedValue(new Error('minio down'));

      const result = await service.uploadAvatar(userId, pngFile);

      expect(result.avatar).toContain('/avatars/');
    });

    it('wraps MinIO upload failures in InternalServerErrorException', async () => {
      repo.findOneBy.mockResolvedValue(makeUser());
      minioClient.putObject.mockRejectedValue(new Error('boom'));

      await expect(service.uploadAvatar(userId, pngFile)).rejects.toEqual(
        new InternalServerErrorException('Could not upload avatar'),
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('falls back to the mimetype extension when the file name has none', async () => {
      repo.findOneBy.mockResolvedValue(makeUser());

      await service.uploadAvatar(userId, {
        ...pngFile,
        originalname: 'no-extension',
      });

      const [, objectKey] = minioClient.putObject.mock.calls[0];
      expect(String(objectKey)).toMatch(/\.png$/);
    });

    it('throws NotFoundException when the user does not exist', async () => {
      await expect(service.uploadAvatar('missing-id', pngFile)).rejects.toEqual(
        new NotFoundException('User not found'),
      );
      expect(minioClient.putObject).not.toHaveBeenCalled();
    });
  });
});
