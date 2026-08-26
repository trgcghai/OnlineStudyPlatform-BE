import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { CoursesService } from './courses.service';
import { PublicCoursesController } from './public-courses.controller';

describe('PublicCoursesController', () => {
  let controller: PublicCoursesController;
  let service: {
    findPublished: jest.Mock;
    findPublishedSuggestions: jest.Mock;
    findLatestPublished: jest.Mock;
    getPublished: jest.Mock;
  };

  const courseId = '33333333-3333-4333-8333-333333333333';

  beforeEach(async () => {
    service = {
      findPublished: jest.fn(),
      findPublishedSuggestions: jest.fn(),
      findLatestPublished: jest.fn(),
      getPublished: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicCoursesController],
      providers: [{ provide: CoursesService, useValue: service }],
    }).compile();

    controller = module.get<PublicCoursesController>(PublicCoursesController);
  });

  it('delegates public course listing with filters and sorting', async () => {
    const query = {
      page: 1,
      limit: 10,
      q: 'nestjs',
      category: 'Backend',
      sortBy: 'updatedAt' as const,
      sortOrder: 'DESC' as const,
    };

    await controller.findPublished(query);

    expect(service.findPublished).toHaveBeenCalledWith(query);
  });

  it('delegates public suggestions with a limit', async () => {
    const query = { limit: 5 };

    await controller.findPublishedSuggestions(query);

    expect(service.findPublishedSuggestions).toHaveBeenCalledWith(query);
  });

  it('delegates latest published courses with a limit', async () => {
    const query = { limit: 8 };

    await controller.findLatestPublished(query);

    expect(service.findLatestPublished).toHaveBeenCalledWith(query);
  });

  it('delegates public course detail by id', async () => {
    await controller.getPublished(courseId);

    expect(service.getPublished).toHaveBeenCalledWith(courseId);
  });
});

describe('PublicCoursesController auth metadata', () => {
  type HandlerName =
    | 'findPublished'
    | 'findPublishedSuggestions'
    | 'findLatestPublished'
    | 'getPublished';

  const handlerOf = (methodName: HandlerName): unknown =>
    Object.getOwnPropertyDescriptor(
      PublicCoursesController.prototype,
      methodName,
    )?.value;

  it('has no controller-level roles or guards', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, PublicCoursesController),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PublicCoursesController),
    ).toBeUndefined();
  });

  it.each<HandlerName>([
    'findPublished',
    'findPublishedSuggestions',
    'findLatestPublished',
    'getPublished',
  ])('keeps %s public', (handlerName) => {
    expect(
      Reflect.getMetadata(ROLES_KEY, handlerOf(handlerName)),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(GUARDS_METADATA, handlerOf(handlerName)),
    ).toBeUndefined();
  });

  it('does not need RolesGuard to pass anonymous users', () => {
    const reflector = new Reflector();
    expect(
      reflector.get(ROLES_KEY, handlerOf('findPublished')),
    ).toBeUndefined();
  });
});
