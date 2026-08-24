import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { CourseStatus } from './entities/course.entity';

describe('CoursesController', () => {
  let controller: CoursesController;
  let service: {
    create: jest.Mock;
    findMine: jest.Mock;
    getOwned: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    requestPublish: jest.Mock;
    uploadThumbnail: jest.Mock;
  };

  const instructorId = '11111111-1111-4111-8111-111111111111';
  const courseId = '33333333-3333-4333-8333-333333333333';

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findMine: jest.fn(),
      getOwned: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      requestPublish: jest.fn(),
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
});

describe('CoursesController RBAC', () => {
  type HandlerName =
    | 'create'
    | 'findMine'
    | 'getOwned'
    | 'update'
    | 'remove'
    | 'requestPublish'
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

  it('protects the controller with Instructor role metadata', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CoursesController)).toEqual([
      UserRole.INSTRUCTOR,
    ]);
  });

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
