import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import {
  ChangePasswordDto,
  CreateUserDto,
  UpdateProfileDto,
} from './dto/user.dto';

describe('UsersController', () => {
  let controller: UsersController;
  let service: {
    create: jest.Mock;
    getProfile: jest.Mock;
    updateProfile: jest.Mock;
    changePassword: jest.Mock;
    uploadAvatar: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      getProfile: jest.fn(),
      updateProfile: jest.fn(),
      changePassword: jest.fn(),
      uploadAvatar: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates create to the service', async () => {
    const dto: CreateUserDto = {
      name: 'Nguyen Van A',
      email: 'a@example.com',
      password: 'abcd1234!',
    };
    await controller.create(dto);
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('delegates getMe with the current user id from the JWT', async () => {
    await controller.getMe('user-id');
    expect(service.getProfile).toHaveBeenCalledWith('user-id');
  });

  it('delegates updateMe with the current user id and dto', async () => {
    const dto: UpdateProfileDto = { name: 'New Name' };
    await controller.updateMe('user-id', dto);
    expect(service.updateProfile).toHaveBeenCalledWith('user-id', dto);
  });

  it('returns passwordChanged after a successful password change', async () => {
    const dto: ChangePasswordDto = {
      currentPassword: 'OldPass@123',
      newPassword: 'NewPass@456',
    };
    const result = await controller.changePassword('user-id', dto);

    expect(service.changePassword).toHaveBeenCalledWith('user-id', dto);
    expect(result).toEqual({ passwordChanged: true });
  });

  it('rejects an avatar request without a file with BadRequestException', async () => {
    await expect(controller.uploadAvatar('user-id', undefined)).rejects.toThrow(
      'Avatar image is required',
    );
    expect(service.uploadAvatar).not.toHaveBeenCalled();
  });

  it('delegates avatar upload with the current user id and file', async () => {
    const file = {
      fieldname: 'avatar',
      originalname: 'me.png',
      mimetype: 'image/png',
      size: 4,
      buffer: Buffer.from('png!'),
    } as Express.Multer.File;

    await controller.uploadAvatar('user-id', file);

    expect(service.uploadAvatar).toHaveBeenCalledWith('user-id', file);
  });
});
