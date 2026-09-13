import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { UpsertInstructorAccountDto } from './dto/instructor-account.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import {
  ChangePasswordDto,
  CreateUserDto,
  UpdateProfileDto,
} from './dto/user.dto';
import { UserRole } from './entities/user.entity';

describe('UsersController', () => {
  let controller: UsersController;
  let service: {
    create: jest.Mock;
    getProfile: jest.Mock;
    updateProfile: jest.Mock;
    getMyInstructorAccount: jest.Mock;
    upsertMyInstructorAccount: jest.Mock;
    changePassword: jest.Mock;
    uploadAvatar: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      getProfile: jest.fn(),
      updateProfile: jest.fn(),
      getMyInstructorAccount: jest.fn(),
      upsertMyInstructorAccount: jest.fn(),
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

  it('delegates getMyInstructorAccount with current instructor id', async () => {
    await controller.getMyInstructorAccount('instructor-id');
    expect(service.getMyInstructorAccount).toHaveBeenCalledWith(
      'instructor-id',
    );
  });

  it('delegates upsertMyInstructorAccount with current instructor id and dto', async () => {
    const dto: UpsertInstructorAccountDto = {
      bankName: 'VCB',
      bankAccountNumber: '123456789',
      accountHolderName: 'NGUYEN VAN A',
    };

    await controller.upsertMyInstructorAccount('instructor-id', dto);

    expect(service.upsertMyInstructorAccount).toHaveBeenCalledWith(
      'instructor-id',
      dto,
    );
  });

  it('requires Instructor role for instructor account self endpoints', () => {
    const getMethod = Object.getOwnPropertyDescriptor(
      UsersController.prototype,
      'getMyInstructorAccount',
    )?.value;
    const putMethod = Object.getOwnPropertyDescriptor(
      UsersController.prototype,
      'upsertMyInstructorAccount',
    )?.value;

    expect(Reflect.getMetadata(ROLES_KEY, getMethod)).toEqual([
      UserRole.INSTRUCTOR,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, putMethod)).toEqual([
      UserRole.INSTRUCTOR,
    ]);
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

  it('rejects an avatar request without a file with BadRequestException', () => {
    expect(() => controller.uploadAvatar('user-id', undefined)).toThrow(
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
