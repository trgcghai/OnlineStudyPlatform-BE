import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { AdminCourseController } from './admin-course.controller';
import { CoursesService } from './courses.service';

describe('AdminCourseController', () => {
  let controller: AdminCourseController;
  let service: {
    listLessonsWithQuizzes: jest.Mock;
  };

  const courseId = '33333333-3333-4333-8333-333333333333';

  beforeEach(async () => {
    service = {
      listLessonsWithQuizzes: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminCourseController],
      providers: [{ provide: CoursesService, useValue: service }],
    }).compile();

    controller = module.get(AdminCourseController);
  });

  it('delegates lesson listing with quiz summaries to the service', async () => {
    await controller.listLessonsWithQuizzes(courseId);

    expect(service.listLessonsWithQuizzes).toHaveBeenCalledWith(courseId);
  });
});

describe('AdminCourseController RBAC', () => {
  const handler = Object.getOwnPropertyDescriptor(
    AdminCourseController.prototype,
    'listLessonsWithQuizzes',
  )?.value;

  const buildContext = (
    handler?: unknown,
    user?: { id: string; role: UserRole },
  ) => ({
    switchToHttp: () => ({
      getRequest: <T>() => ({ user }) as T,
    }),
    getHandler: () => handler,
    getClass: () => AdminCourseController,
  });

  const reflector = new Reflector();

  it('restricts the controller class to Admin', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminCourseController)).toEqual([
      UserRole.ADMIN,
    ]);
  });

  it('allows an Admin through', () => {
    expect(
      new RolesGuard(reflector).canActivate(
        buildContext(handler, {
          id: 'admin-id',
          role: UserRole.ADMIN,
        }) as never,
      ),
    ).toBe(true);
  });

  it('rejects anonymous requests with UnauthorizedException', () => {
    expect(() =>
      new RolesGuard(reflector).canActivate(buildContext(handler) as never),
    ).toThrow(UnauthorizedException);
  });

  it.each([UserRole.INSTRUCTOR, UserRole.LEARNER])(
    'denies %s with ForbiddenException',
    (role) => {
      expect(() =>
        new RolesGuard(reflector).canActivate(
          buildContext(handler, { id: 'user-id', role }) as never,
        ),
      ).toThrow(ForbiddenException);
    },
  );
});
