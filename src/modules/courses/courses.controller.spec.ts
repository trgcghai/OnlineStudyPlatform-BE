import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  CACHE_INVALIDATE_METADATA,
  CACHE_METADATA,
} from '../redis/redis.constants';
import { UserRole } from '../users/entities/user.entity';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { CourseStatus } from './entities/course.entity';

describe('CoursesController', () => {
  let controller: CoursesController;
  let service: {
    create: jest.Mock;
    findMine: jest.Mock;
    findPendingApprovals: jest.Mock;
    getOwned: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    requestPublish: jest.Mock;
    reviewCourseStatus: jest.Mock;
    uploadThumbnail: jest.Mock;
  };

  const instructorId = '11111111-1111-4111-8111-111111111111';
  const courseId = '33333333-3333-4333-8333-333333333333';
  const handlerOf = (methodName: keyof CoursesController): object =>
    Object.getOwnPropertyDescriptor(CoursesController.prototype, methodName)!
      .value as object;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findMine: jest.fn(),
      findPendingApprovals: jest.fn(),
      getOwned: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      requestPublish: jest.fn(),
      reviewCourseStatus: jest.fn(),
      uploadThumbnail: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CoursesController],
      providers: [{ provide: CoursesService, useValue: service }],
    }).compile();

    controller = module.get<CoursesController>(CoursesController);
  });

  it('delegates create with the current Instructor id', async () => {
    const dto = {
      title: 'NestJS',
      description: 'Intro',
      category: 'Backend',
    };

    await controller.create(instructorId, dto);

    expect(service.create).toHaveBeenCalledWith(instructorId, dto);
  });

  it('delegates list with query filters', async () => {
    const query = { page: 1, limit: 10, status: CourseStatus.DRAFT };

    await controller.findMine(instructorId, query);

    expect(service.findMine).toHaveBeenCalledWith(instructorId, query);
  });

  it('delegates get, update, delete, and thumbnail ownership operations', async () => {
    const file = { originalname: 'cover.png' } as Express.Multer.File;

    await controller.getOwned(courseId, instructorId);
    await controller.update(courseId, instructorId, { title: 'New title' });
    await controller.remove(courseId, instructorId);
    await controller.uploadThumbnail(courseId, instructorId, file);

    expect(service.getOwned).toHaveBeenCalledWith(courseId, instructorId);
    expect(service.update).toHaveBeenCalledWith(courseId, instructorId, {
      title: 'New title',
    });
    expect(service.remove).toHaveBeenCalledWith(courseId, instructorId);
    expect(service.uploadThumbnail).toHaveBeenCalledWith(
      courseId,
      instructorId,
      file,
    );
  });

  it('delegates request publish with course id and current Instructor id', async () => {
    await controller.requestPublish(courseId, instructorId);

    expect(service.requestPublish).toHaveBeenCalledWith(courseId, instructorId);
  });

  it('delegates pending approval list with pagination and filters', async () => {
    const query = {
      page: 1,
      limit: 10,
      q: 'nestjs',
      category: 'Backend',
      sortBy: 'updatedAt' as const,
      sortOrder: 'DESC' as const,
    };

    await controller.findPendingApprovals(query);

    expect(service.findPendingApprovals).toHaveBeenCalledWith(query);
  });

  it('delegates course status review', async () => {
    const dto = { status: CourseStatus.PUBLISHED };

    await controller.reviewCourseStatus(courseId, dto);

    expect(service.reviewCourseStatus).toHaveBeenCalledWith(courseId, dto);
  });

  it('caches instructor course reads by current user', () => {
    expect(Reflect.getMetadata(CACHE_METADATA, handlerOf('findMine'))).toEqual({
      namespace: 'instructor:courses:list',
      ttl: 60,
      scope: 'user',
    });
    expect(Reflect.getMetadata(CACHE_METADATA, handlerOf('getOwned'))).toEqual({
      namespace: 'instructor:courses:detail',
      ttl: 60,
      scope: 'user',
    });
  });

  it.each([
    ['create', ['courses:public:list', 'instructor:courses:list']],
    [
      'requestPublish',
      [
        'courses:public:list',
        'courses:public:detail',
        'instructor:courses:list',
        'instructor:courses:detail',
        'learning:course',
        'learning:lesson',
      ],
    ],
    [
      'reviewCourseStatus',
      [
        'courses:public:list',
        'courses:public:detail',
        'instructor:courses:list',
        'instructor:courses:detail',
        'learning:course',
        'learning:lesson',
      ],
    ],
    [
      'update',
      [
        'courses:public:list',
        'courses:public:detail',
        'instructor:courses:list',
        'instructor:courses:detail',
        'learning:course',
        'learning:lesson',
      ],
    ],
    [
      'remove',
      [
        'courses:public:list',
        'courses:public:detail',
        'instructor:courses:list',
        'instructor:courses:detail',
        'learning:course',
        'learning:lesson',
      ],
    ],
    [
      'uploadThumbnail',
      [
        'courses:public:list',
        'courses:public:detail',
        'instructor:courses:list',
        'instructor:courses:detail',
        'learning:course',
        'learning:lesson',
      ],
    ],
  ])('invalidates instructor course cache on %s', (handlerName, namespaces) => {
    expect(
      Reflect.getMetadata(
        CACHE_INVALIDATE_METADATA,
        handlerOf(handlerName as keyof CoursesController),
      ),
    ).toEqual(namespaces);
  });
});

describe('CoursesController RBAC', () => {
  type HandlerName =
    | 'create'
    | 'findMine'
    | 'getOwned'
    | 'update'
    | 'remove'
    | 'requestPublish'
    | 'findPendingApprovals'
    | 'reviewCourseStatus'
    | 'uploadThumbnail';

  const handlerOf = (methodName: HandlerName): unknown =>
    Object.getOwnPropertyDescriptor(CoursesController.prototype, methodName)
      ?.value;

  const buildContext = (
    handler?: unknown,
    user?: { id: string; role: UserRole },
  ) => ({
    switchToHttp: () => ({
      getRequest: <T>() => ({ user }) as T,
    }),
    getHandler: () => handler,
    getClass: () => CoursesController,
  });

  const reflector = new Reflector();

  const runGuard = (user?: { id: string; role: UserRole }): boolean =>
    new RolesGuard(reflector).canActivate(
      buildContext(handlerOf('findMine'), user) as never,
    );

  it('does not set a class-level role because endpoints define roles individually', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CoursesController)).toBeUndefined();
  });

  it.each<HandlerName>([
    'create',
    'findMine',
    'getOwned',
    'update',
    'remove',
    'requestPublish',
    'uploadThumbnail',
  ])('keeps %s restricted to Instructor', (handlerName) => {
    expect(Reflect.getMetadata(ROLES_KEY, handlerOf(handlerName))).toEqual([
      UserRole.INSTRUCTOR,
    ]);
  });

  it.each<HandlerName>(['findPendingApprovals', 'reviewCourseStatus'])(
    'keeps %s restricted to Admin',
    (handlerName) => {
      expect(Reflect.getMetadata(ROLES_KEY, handlerOf(handlerName))).toEqual([
        UserRole.ADMIN,
      ]);
    },
  );

  it('allows an Instructor through', () => {
    expect(runGuard({ id: 'instructor-id', role: UserRole.INSTRUCTOR })).toBe(
      true,
    );
  });

  it('keeps request publish protected by Instructor role metadata', () => {
    expect(
      new RolesGuard(reflector).canActivate(
        buildContext(handlerOf('requestPublish'), {
          id: 'instructor-id',
          role: UserRole.INSTRUCTOR,
        }) as never,
      ),
    ).toBe(true);
  });

  it('rejects anonymous requests with UnauthorizedException', () => {
    expect(() => runGuard(undefined)).toThrow(UnauthorizedException);
  });

  it.each([UserRole.ADMIN, UserRole.LEARNER])(
    'denies %s with ForbiddenException',
    (role) => {
      expect(() => runGuard({ id: 'user-id', role })).toThrow(
        ForbiddenException,
      );
    },
  );
});
