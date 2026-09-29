import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CACHE_INVALIDATE_METADATA } from '../redis/redis.constants';
import { UserRole } from '../users/entities/user.entity';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';

describe('EnrollmentsController', () => {
  let controller: EnrollmentsController;
  let service: {
    enroll: jest.Mock;
    findMine: jest.Mock;
    findCourseEnrollmentsForInstructor: jest.Mock;
  };

  const learnerId = '11111111-1111-4111-8111-111111111111';
  const courseId = '22222222-2222-4222-8222-222222222222';
  const instructorId = '33333333-3333-4333-8333-333333333333';

  beforeEach(async () => {
    service = {
      enroll: jest.fn(),
      findMine: jest.fn(),
      findCourseEnrollmentsForInstructor: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EnrollmentsController],
      providers: [{ provide: EnrollmentsService, useValue: service }],
    }).compile();

    controller = module.get<EnrollmentsController>(EnrollmentsController);
  });

  it('delegates course enrollment to the service', async () => {
    await controller.enroll(courseId, learnerId);

    expect(service.enroll).toHaveBeenCalledWith(learnerId, courseId);
  });

  it('delegates current learner enrollment listing to the service', async () => {
    await controller.findMine(learnerId);

    expect(service.findMine).toHaveBeenCalledWith(learnerId);
  });

  it('delegates instructor course enrollment listing to the service', async () => {
    const query = { page: 1, limit: 10, q: 'tran' };

    await controller.findCourseEnrollmentsForInstructor(
      courseId,
      instructorId,
      query,
    );

    expect(service.findCourseEnrollmentsForInstructor).toHaveBeenCalledWith(
      instructorId,
      courseId,
      query,
    );
  });
});

describe('EnrollmentsController auth metadata', () => {
  type HandlerName =
    'enroll' | 'findMine' | 'findCourseEnrollmentsForInstructor';

  const handlerOf = (methodName: HandlerName): unknown =>
    Object.getOwnPropertyDescriptor(EnrollmentsController.prototype, methodName)
      ?.value;

  it('uses strict auth and roles guards at controller level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, EnrollmentsController)).toEqual(
      [JwtAuthGuard, RolesGuard],
    );
  });

  it.each<HandlerName>(['enroll', 'findMine'])(
    'restricts %s to Learners',
    (handlerName) => {
      expect(Reflect.getMetadata(ROLES_KEY, handlerOf(handlerName))).toEqual([
        UserRole.LEARNER,
      ]);
    },
  );

  it('restricts findCourseEnrollmentsForInstructor to Instructors', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        handlerOf('findCourseEnrollmentsForInstructor'),
      ),
    ).toEqual([UserRole.INSTRUCTOR]);
  });

  it('invalidates learner-facing caches after enrollment', () => {
    expect(
      Reflect.getMetadata(CACHE_INVALIDATE_METADATA, handlerOf('enroll')),
    ).toEqual([
      'enrollments:learner',
      'recommendations:learner',
      'courses:public:detail',
      'learning:course',
      'learning:lesson',
      'dashboard:learner',
    ]);
  });
});
