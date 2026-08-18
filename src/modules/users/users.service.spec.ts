import { BadRequestException, ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/user.dto';
import { User, UserRole, UserStatus } from './entities/user.entity';

describe('UsersService', () => {
  let service: UsersService;
  let repo: { create: jest.Mock; findOneBy: jest.Mock; save: jest.Mock };

  const dto: CreateUserDto = {
    name: '  Nguyen Van A  ',
    email: '  Test@Example.COM ',
    password: 'abcd1234!',
  };

  beforeEach(() => {
    repo = {
      create: jest.fn((input: Partial<User>) => input),
      findOneBy: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    };
    service = new UsersService(repo as unknown as Repository<User>);
  });

  it('hashes the password before saving and returns the saved user', async () => {
    const saved = {
      id: 'b7f8c2a0-1111-4a11-9f0a-000000000001',
      name: 'Nguyen Van A',
      email: 'test@example.com',
      password: '$2b$10$abcdefghijklmnopqrstuv',
      role: UserRole.LEARNER,
      status: UserStatus.ACTIVE,
      avatar: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User;
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

  it('rejects an existing email with ConflictException', async () => {
    repo.findOneBy.mockResolvedValue({ id: 'existing-user-id' });

    await expect(service.create(dto)).rejects.toEqual(
      new ConflictException('Email already registered'),
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('wraps unrelated database errors in BadRequestException', async () => {
    const error = new Error('connection reset');
    repo.save.mockRejectedValue(error);

    await expect(service.create(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
