import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersController } from './users.controller';
import { AdminUsersController } from './admin-users.controller';
import { UsersService } from './users.service';
import { CreateAdminUserDto, UpdateAdminUserDto } from './dto/admin-user.dto';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole, UserStatus } from './entities/user.entity';

describe('AdminUsersController', () => {
  let controller: AdminUsersController;
  let service: {
    findAllForAdmin: jest.Mock;
    createAsAdmin: jest.Mock;
    updateAsAdmin: jest.Mock;
    disableUser: jest.Mock;
    getInstructorAccountForAdmin: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      findAllForAdmin: jest.fn(),
      createAsAdmin: jest.fn(),
      updateAsAdmin: jest.fn(),
      disableUser: jest.fn(),
      getInstructorAccountForAdmin: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminUsersController],
      providers: [{ provide: UsersService, useValue: service }],
    }).compile();

    controller = module.get<AdminUsersController>(AdminUsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates list with query filters', async () => {
    const query = { role: UserRole.INSTRUCTOR, status: UserStatus.ACTIVE };
    await controller.list(query);
    expect(service.findAllForAdmin).toHaveBeenCalledWith(query);
  });

  it('delegates create to createAsAdmin', async () => {
    const dto: CreateAdminUserDto = {
      name: 'Instructor A',
      email: 'instructor@example.com',
      password: 'abcd1234!',
      role: UserRole.INSTRUCTOR,
    };
    await controller.create(dto);
    expect(service.createAsAdmin).toHaveBeenCalledWith(dto);
  });

  it('delegates update to updateAsAdmin', async () => {
    const dto: UpdateAdminUserDto = { name: 'New Name' };
    await controller.update('user-id', dto);
    expect(service.updateAsAdmin).toHaveBeenCalledWith('user-id', dto);
  });

  it('delegates disable to disableUser', async () => {
    await controller.disable('user-id');
    expect(service.disableUser).toHaveBeenCalledWith('user-id');
  });

  it('delegates instructor account lookup to the service', async () => {
    await controller.getInstructorAccount('instructor-id');
    expect(service.getInstructorAccountForAdmin).toHaveBeenCalledWith(
      'instructor-id',
    );
  });
});

describe('AdminUsersController RBAC', () => {
  type HandlerName =
    'list' | 'create' | 'update' | 'disable' | 'getInstructorAccount';

  const handlerOf = (methodName: HandlerName): unknown =>
    Object.getOwnPropertyDescriptor(AdminUsersController.prototype, methodName)
      ?.value;

  const buildContext = (
    handler?: unknown,
    user?: { id: string; role: UserRole },
  ) => ({
    switchToHttp: () => ({
      getRequest: <T>() => ({ user }) as T,
    }),
    getHandler: () => handler,
    getClass: () => AdminUsersController,
  });

  const reflector = new Reflector();

  const runGuard = (user?: { id: string; role: UserRole }): boolean =>
    new RolesGuard(reflector).canActivate(
      buildContext(handlerOf('list'), user) as never,
    );

  it('protects the whole controller with the Admin role metadata', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminUsersController)).toEqual([
      UserRole.ADMIN,
    ]);

    const handlerNames: HandlerName[] = [
      'list',
      'create',
      'update',
      'disable',
      'getInstructorAccount',
    ];
    for (const name of handlerNames) {
      expect(handlerOf(name)).toEqual(expect.any(Function));
    }
  });

  it('allows an Admin through', () => {
    expect(runGuard({ id: 'admin-id', role: UserRole.ADMIN })).toBe(true);
  });

  it('rejects an anonymous request with UnauthorizedException', () => {
    expect(() => runGuard(undefined)).toThrow(UnauthorizedException);
  });

  it.each([UserRole.LEARNER, UserRole.INSTRUCTOR])(
    'denies %s with ForbiddenException (RBAC)',
    (role) => {
      expect(() => runGuard({ id: 'user-id', role })).toThrow(
        ForbiddenException,
      );
    },
  );

  it('keeps the public UsersController free of role restrictions', () => {
    expect(Reflect.getMetadata(ROLES_KEY, UsersController)).toBeUndefined();
  });
});
