import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';

describe('EnrollmentsController', () => {
  let controller: EnrollmentsController;
  let service: { enroll: jest.Mock; findMine: jest.Mock };

  const learnerId = '11111111-1111-4111-8111-111111111111';
  const courseId = '22222222-2222-4222-8222-222222222222';

  beforeEach(async () => {
    service = { enroll: jest.fn(), findMine: jest.fn() };

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
});

describe('EnrollmentsController auth metadata', () => {
  type HandlerName = 'enroll' | 'findMine';

  const handlerOf = (methodName: HandlerName): unknown =>
    Object.getOwnPropertyDescriptor(
      EnrollmentsController.prototype,
      methodName,
    )?.value;

  it('uses strict auth and roles guards at controller level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, EnrollmentsController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
  });

  it.each<HandlerName>(['enroll', 'findMine'])(
    'restricts %s to Learners',
    (handlerName) => {
      expect(Reflect.getMetadata(ROLES_KEY, handlerOf(handlerName))).toEqual([
        UserRole.LEARNER,
      ]);
    },
  );
});
