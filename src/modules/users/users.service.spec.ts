import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { UsersService } from './users.service';
import {
  ADMIN_ASSIGNABLE_ROLES,
  AdminListUsersQueryDto,
  CreateAdminUserDto,
  UpdateAdminUserDto,
} from './dto/admin-user.dto';
import {
  ChangePasswordDto,
  CreateUserDto,
  UpdateProfileDto,
} from './dto/user.dto';
import { InstructorAccount } from './entities/instructor-account.entity';
import { User, UserRole, UserStatus } from './entities/user.entity';

describe('UsersService', () => {
  let service: UsersService;
  let repo: {
    create: jest.Mock;
    findOneBy: jest.Mock;
    query: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let accountRepo: {
    create: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let s3Client: { send: jest.Mock };
  let configService: { getOrThrow: jest.Mock };
  let redis: { keys: jest.Mock; del: jest.Mock };
  let bankCatalogModel: {
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };

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

  const makeInstructor = (): User => ({
    ...makeUser(),
    id: 'b7f8c2a0-1111-4a11-9f0a-000000000099',
    role: UserRole.INSTRUCTOR,
  });

  const makeInstructorAccount = (
    overrides: Partial<InstructorAccount> = {},
  ): InstructorAccount => ({
    id: 'acc-11111111-1111-4111-8111-111111111111',
    instructorId: makeInstructor().id,
    instructor: makeInstructor(),
    bankName: 'VCB',
    bankAccountNumber: '123456789',
    accountHolderName: 'NGUYEN VAN A',
    bankCode: 'VCB',
    branchName: null,
    phoneNumber: null,
    note: null,
    createdAt: new Date('2026-01-02T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  });

  const userId = 'b7f8c2a0-1111-4a11-9f0a-000000000001';

  const dto: CreateUserDto = {
    name: '  Nguyen Van A  ',
    email: '  Test@Example.COM ',
    password: 'abcd1234!',
  };

  beforeEach(() => {
    global.fetch = jest.fn();
    repo = {
      create: jest.fn((input: Partial<User>) => input),
      findOneBy: jest.fn().mockResolvedValue(null),
      query: jest.fn().mockResolvedValue(undefined),
      save: jest.fn((input: Partial<User>) => ({
        ...makeUser(),
        ...input,
      })),
      createQueryBuilder: jest.fn(),
    };
    accountRepo = {
      create: jest.fn((input: Partial<InstructorAccount>) => input),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn((input: Partial<InstructorAccount>) => ({
        ...makeInstructorAccount(),
        ...input,
      })),
    };
    s3Client = { send: jest.fn().mockResolvedValue({}) };
    configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'MINIO_BUCKET') return 'lms-bucket';
        if (key === 'MINIO_ENDPOINT') return 'http://localhost:9000';
        return undefined;
      }),
    };
    redis = {
      keys: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(0),
    };
    bankCatalogModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    service = new UsersService(
      repo as unknown as Repository<User>,
      accountRepo as unknown as Repository<InstructorAccount>,
      configService as unknown as ConfigService,
      s3Client as never,
      redis as never,
      bankCatalogModel as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('listBanks', () => {
    const vietQrResponse = {
      data: [
        {
          name: 'Ngân hàng TMCP Ngoại Thương Việt Nam',
          code: 'VCB',
          bin: '970436',
          short_name: 'Vietcombank',
          supported: true,
        },
      ],
    };

    it('fetches VietQR, normalizes, caches, and upserts MongoDB when memory cache is empty', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(vietQrResponse),
      });
      bankCatalogModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({}),
      });

      const result = await service.listBanks();

      expect(result).toEqual([
        {
          name: 'Ngân hàng TMCP Ngoại Thương Việt Nam',
          code: 'VCB',
          bin: '970436',
          shortName: 'Vietcombank',
        },
      ]);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://vietqr.app/banks.json',
      );
      expect(bankCatalogModel.findOneAndUpdate).toHaveBeenCalledWith(
        { source: 'vietqr' },
        expect.objectContaining({
          source: 'vietqr',
          banks: result,
        }),
        { upsert: true, returnDocument: 'after' },
      );

      await service.listBanks();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('falls back to MongoDB and caches Mongo result when VietQR fetch fails', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('network down'));
      bankCatalogModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          banks: [
            {
              name: 'Mongo bank',
              code: 'MB',
              bin: '970422',
              shortName: 'MBBank',
            },
          ],
        }),
      });

      const result = await service.listBanks();

      expect(result).toEqual([
        { name: 'Mongo bank', code: 'MB', bin: '970422', shortName: 'MBBank' },
      ]);

      await service.listBanks();
      expect(bankCatalogModel.findOne).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid live API data and falls back to MongoDB', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: [
            { name: 'Bad', code: '<script>', bin: 'abc', short_name: 'Bad' },
          ],
        }),
      });
      bankCatalogModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          banks: [
            {
              name: 'Fallback',
              code: 'VCB',
              bin: '970436',
              shortName: 'Vietcombank',
            },
          ],
        }),
      });

      await expect(service.listBanks()).resolves.toEqual([
        {
          name: 'Fallback',
          code: 'VCB',
          bin: '970436',
          shortName: 'Vietcombank',
        },
      ]);
      expect(bankCatalogModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
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
        status: UserStatus.PENDING_VERIFICATION,
      }),
    );
    expect(repo.query).toHaveBeenCalledWith(
      `ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS '${UserStatus.PENDING_VERIFICATION}'`,
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

  describe('instructor account', () => {
    const instructor = makeInstructor();
    const bankCatalog = {
      source: 'vietqr',
      banks: [
        {
          name: 'Ngân hàng TMCP Ngoại thương Việt Nam',
          code: 'VCB',
          bin: '970436',
          shortName: 'Vietcombank',
        },
        {
          name: 'Ngân hàng TMCP Á Châu',
          code: 'ACB',
          bin: '970416',
          shortName: 'ACB',
        },
      ],
    };
    const accountDto = {
      bankName: ' Ignored client value ',
      bankAccountNumber: ' 123456789 ',
      accountHolderName: ' Nguyen Van A ',
      bankCode: ' VCB ',
      branchName: '',
      phoneNumber: ' 0909000000 ',
      note: ' Main payout account ',
    };

    it('returns null for missing own instructor account', async () => {
      accountRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getMyInstructorAccount(instructor.id),
      ).resolves.toBeNull();
      expect(accountRepo.findOne).toHaveBeenCalledWith({
        where: { instructorId: instructor.id },
      });
    });

    it('creates an instructor account when none exists', async () => {
      accountRepo.findOne.mockResolvedValue(null);
      bankCatalogModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(bankCatalog),
      });

      const result = await service.upsertMyInstructorAccount(
        instructor.id,
        accountDto,
      );

      expect(accountRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          instructorId: instructor.id,
          bankName: 'Ngân hàng TMCP Ngoại thương Việt Nam',
          bankAccountNumber: '123456789',
          accountHolderName: 'Nguyen Van A',
          bankCode: 'VCB',
          branchName: null,
          phoneNumber: '0909000000',
          note: 'Main payout account',
        }),
      );
      expect(result).toMatchObject({
        instructorId: instructor.id,
        bankName: 'Ngân hàng TMCP Ngoại thương Việt Nam',
        branchName: null,
      });
    });

    it('updates an existing instructor account', async () => {
      const account = makeInstructorAccount({ instructorId: instructor.id });
      accountRepo.findOne.mockResolvedValue(account);
      bankCatalogModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(bankCatalog),
      });

      const result = await service.upsertMyInstructorAccount(instructor.id, {
        ...accountDto,
        bankCode: 'ACB',
      });

      expect(accountRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: account.id,
          bankName: 'Ngân hàng TMCP Á Châu',
          bankCode: 'ACB',
        }),
      );
      expect(result.bankName).toBe('Ngân hàng TMCP Á Châu');
    });

    it('rejects an instructor account when bank code is not in catalog', async () => {
      accountRepo.findOne.mockResolvedValue(null);
      bankCatalogModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(bankCatalog),
      });

      await expect(
        service.upsertMyInstructorAccount(instructor.id, {
          ...accountDto,
          bankCode: 'BAD',
        }),
      ).rejects.toEqual(new BadRequestException('Bank code is not supported'));
      expect(accountRepo.create).not.toHaveBeenCalled();
      expect(accountRepo.save).not.toHaveBeenCalled();
    });

    it('returns account for admin when target user is an instructor', async () => {
      repo.findOneBy.mockResolvedValue(instructor);
      accountRepo.findOne.mockResolvedValue(makeInstructorAccount());

      const result = await service.getInstructorAccountForAdmin(instructor.id);

      expect(repo.findOneBy).toHaveBeenCalledWith({ id: instructor.id });
      expect(result).toMatchObject({ instructorId: instructor.id });
    });

    it('returns null to admin when instructor has no account', async () => {
      repo.findOneBy.mockResolvedValue(instructor);
      accountRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getInstructorAccountForAdmin(instructor.id),
      ).resolves.toBeNull();
    });

    it.each([
      ['missing user', null],
      ['learner user', makeUser()],
      ['admin user', { ...makeUser(), role: UserRole.ADMIN }],
    ])('throws NotFoundException for %s', async (_name, user) => {
      repo.findOneBy.mockResolvedValue(user);

      await expect(
        service.getInstructorAccountForAdmin('not-an-instructor-id'),
      ).rejects.toEqual(new NotFoundException('Instructor not found'));
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

      const put = s3Client.send.mock.calls
        .map(([command]) => command)
        .find((command) => command instanceof PutObjectCommand);
      expect(put?.input).toMatchObject({
        Bucket: 'lms-bucket',
        Key: expect.stringMatching(/^avatars\/b7f8c2a0-.+\.png$/),
        Body: pngFile.buffer,
        ContentLength: pngFile.size,
        ContentType: 'image/png',
      });
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

      expect(
        s3Client.send.mock.calls.map(([command]) => command),
      ).toContainEqual(
        expect.objectContaining({
          input: { Bucket: 'lms-bucket', Key: 'avatars/old.jpg' },
        }),
      );
    });

    it('still succeeds when removing the old object fails', async () => {
      repo.findOneBy.mockResolvedValue({
        ...makeUser(),
        avatar: 'http://localhost:9000/lms-bucket/avatars/old.jpg',
      });
      s3Client.send
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('minio down'));

      const result = await service.uploadAvatar(userId, pngFile);

      expect(result.avatar).toContain('/avatars/');
    });

    it('wraps MinIO upload failures in InternalServerErrorException', async () => {
      repo.findOneBy.mockResolvedValue(makeUser());
      s3Client.send.mockRejectedValueOnce(new Error('boom'));

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

      const command = s3Client.send.mock.calls[0][0] as PutObjectCommand;
      const objectKey = command.input.Key;
      expect(String(objectKey)).toMatch(/\.png$/);
    });

    it('throws NotFoundException when the user does not exist', async () => {
      await expect(service.uploadAvatar('missing-id', pngFile)).rejects.toEqual(
        new NotFoundException('User not found'),
      );
      expect(s3Client.send).not.toHaveBeenCalled();
    });
  });

  describe('createAsAdmin', () => {
    const adminDto: CreateAdminUserDto = {
      name: '  Instructor A  ',
      email: '  Instructor@Example.COM ',
      password: 'abcd1234!',
      role: UserRole.INSTRUCTOR,
    };

    it('creates an account with the requested assignable role', async () => {
      repo.save.mockResolvedValue(makeUser());

      await service.createAsAdmin(adminDto);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Instructor A',
          email: 'instructor@example.com',
          password: expect.stringMatching(/^\$2[ab]\$\d+\$/),
          role: UserRole.INSTRUCTOR,
        }),
      );
    });

    it('rejects duplicate email with ConflictException', async () => {
      repo.findOneBy.mockResolvedValue({ id: 'existing-user-id' });

      await expect(service.createAsAdmin(adminDto)).rejects.toEqual(
        new ConflictException('Email already registered'),
      );
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('findAllForAdmin', () => {
    const buildQueryBuilder = (options?: {
      count?: number;
      users?: User[];
    }) => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(options?.count ?? 0),
        getMany: jest.fn().mockResolvedValue(options?.users ?? []),
      };
      repo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    };

    it('always scopes the list to assignable (non-admin) roles and paginates', async () => {
      const users = [makeUser()];
      const qb = buildQueryBuilder({ count: 1, users });

      const result = await service.findAllForAdmin(
        new AdminListUsersQueryDto(),
      );

      expect(repo.createQueryBuilder).toHaveBeenCalledWith('user');
      expect(qb.where).toHaveBeenCalledWith('user.role IN (:...roles)', {
        roles: ADMIN_ASSIGNABLE_ROLES,
      });
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(result).toEqual({
        items: [expect.any(Object)],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      expect(result.items[0]).not.toHaveProperty('password');
      expect(result.items[0]).toMatchObject({ id: userId });
    });

    it('applies role, status and search filters', async () => {
      const qb = buildQueryBuilder();

      await service.findAllForAdmin({
        role: UserRole.INSTRUCTOR,
        status: UserStatus.INACTIVE,
        q: 'hai',
        page: 2,
        limit: 5,
      });

      expect(qb.andWhere).toHaveBeenCalledWith('user.role = :role', {
        role: UserRole.INSTRUCTOR,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('user.status = :status', {
        status: UserStatus.INACTIVE,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(user.name ILIKE :search OR user.email ILIKE :search)',
        { search: '%hai%' },
      );
      expect(qb.skip).toHaveBeenCalledWith(5);
      expect(qb.take).toHaveBeenCalledWith(5);
    });

    it('never returns zero total pages even with no rows', async () => {
      buildQueryBuilder({ count: 0, users: [] });

      const result = await service.findAllForAdmin(
        new AdminListUsersQueryDto(),
      );

      expect(result.totalPages).toBe(1);
    });
  });

  describe('updateAsAdmin', () => {
    const baseUpdate: UpdateAdminUserDto = { name: 'Updated Name' };

    it('updates name, role and status of a learner', async () => {
      repo.findOneBy.mockResolvedValue(makeUser());
      repo.save.mockImplementation((input: User) => input);

      const result = await service.updateAsAdmin(userId, {
        name: '  Updated Name  ',
        role: UserRole.INSTRUCTOR,
        status: UserStatus.INACTIVE,
      });

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        name: 'Updated Name',
        role: UserRole.INSTRUCTOR,
        status: UserStatus.INACTIVE,
      });
    });

    it('resets the password to a fresh hash when provided', async () => {
      repo.findOneBy.mockResolvedValue(makeUser());
      repo.save.mockImplementation((input: User) => input);

      await service.updateAsAdmin(userId, {
        ...baseUpdate,
        password: 'NewPass@123',
      });

      const savedInput = repo.save.mock.calls[0][0] as User;
      await expect(
        bcrypt.compare('NewPass@123', savedInput.password),
      ).resolves.toBe(true);
    });

    it('rejects an empty payload with BadRequestException', async () => {
      await expect(service.updateAsAdmin(userId, {})).rejects.toEqual(
        new BadRequestException('No changes provided'),
      );
      expect(repo.findOneBy).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the user does not exist', async () => {
      await expect(
        service.updateAsAdmin('missing-id', baseUpdate),
      ).rejects.toEqual(new NotFoundException('User not found'));
    });

    it('refuses to manage an Admin account with ForbiddenException', async () => {
      repo.findOneBy.mockResolvedValue({
        ...makeUser(),
        role: UserRole.ADMIN,
      });

      await expect(service.updateAsAdmin(userId, baseUpdate)).rejects.toEqual(
        new ForbiddenException('Admin accounts cannot be managed here'),
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rejects an email that belongs to another account with ConflictException', async () => {
      repo.findOneBy
        .mockResolvedValueOnce(makeUser())
        .mockResolvedValueOnce({ id: 'other-user-id' });

      await expect(
        service.updateAsAdmin(userId, { email: 'taken@example.com' }),
      ).rejects.toEqual(new ConflictException('Email already registered'));
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('keeps the same email without conflict check', async () => {
      const user = makeUser();
      repo.findOneBy.mockResolvedValue(user);
      repo.save.mockImplementation((input: User) => input);

      await service.updateAsAdmin(userId, { email: user.email });

      expect(repo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('disableUser', () => {
    it('sets status Inactive and revokes refresh sessions', async () => {
      repo.findOneBy.mockResolvedValue(makeUser());
      redis.keys.mockResolvedValue(['auth:refresh:user-id:s1']);
      repo.save.mockImplementation((input: User) => input);

      const result = await service.disableUser(userId);

      expect(result.status).toBe(UserStatus.INACTIVE);
      expect(redis.del).toHaveBeenCalledWith('auth:refresh:user-id:s1');
    });

    it('is idempotent for an already disabled account', async () => {
      repo.findOneBy.mockResolvedValue({
        ...makeUser(),
        status: UserStatus.INACTIVE,
      });

      const result = await service.disableUser(userId);

      expect(result.status).toBe(UserStatus.INACTIVE);
      expect(repo.save).not.toHaveBeenCalled();
      expect(redis.keys).not.toHaveBeenCalled();
    });

    it('still succeeds when Redis session cleanup fails', async () => {
      repo.findOneBy.mockResolvedValue(makeUser());
      redis.keys.mockRejectedValue(new Error('redis down'));
      repo.save.mockImplementation((input: User) => input);

      const result = await service.disableUser(userId);

      expect(result.status).toBe(UserStatus.INACTIVE);
    });

    it('throws NotFoundException when the user does not exist', async () => {
      await expect(service.disableUser('missing-id')).rejects.toEqual(
        new NotFoundException('User not found'),
      );
    });

    it('refuses to disable an Admin account', async () => {
      repo.findOneBy.mockResolvedValue({
        ...makeUser(),
        role: UserRole.ADMIN,
      });

      await expect(service.disableUser(userId)).rejects.toEqual(
        new ForbiddenException('Admin accounts cannot be managed here'),
      );
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
