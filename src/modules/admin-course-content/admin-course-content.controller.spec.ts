import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { AdminCourseContentController } from './admin-course-content.controller';
import { AdminCourseContentService } from './admin-course-content.service';

describe('AdminCourseContentController', () => {
  let controller: AdminCourseContentController;
  let service: {
    listLessonsWithQuizzes: jest.Mock;
  };

  const courseId = '33333333-3333-4333-8333-333333333333';

  beforeEach(async () => {
    service = {
      listLessonsWithQuizzes: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminCourseContentController],
      providers: [{ provide: AdminCourseContentService, useValue: service }],
    }).compile();

    controller = module.get(AdminCourseContentController);
  });

  it('delegates lesson listing with quiz summaries to the service', async () => {
    await controller.listLessonsWithQuizzes(courseId);

    expect(service.listLessonsWithQuizzes).toHaveBeenCalledWith(courseId);
  });
});

describe('AdminCourseContentController RBAC', () => {
  const handler = Object.getOwnPropertyDescriptor(
    AdminCourseContentController.prototype,
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
    getClass: () => AdminCourseContentController,
  });

  const reflector = new Reflector();

  it('restricts the controller class to Admin', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminCourseContentController),
    ).toEqual([UserRole.ADMIN]);
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
