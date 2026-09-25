import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { EssayGradingStatusFilter } from './dto/essay-grading.dto';
import {
  EssayAnswerGradingController,
  EssayGradingController,
} from './essay-grading.controller';
import { EssayGradingService } from './essay-grading.service';

describe('EssayGradingController', () => {
  let controller: EssayGradingController;
  let answerController: EssayAnswerGradingController;
  let service: {
    listSubmissions: jest.Mock;
    gradeEssay: jest.Mock;
  };

  const instructorId = '11111111-1111-4111-8111-111111111111';
  const courseId = '22222222-2222-4222-8222-222222222222';
  const quizId = '33333333-3333-4333-8333-333333333333';
  const attemptId = '44444444-4444-4444-8444-444444444444';
  const questionId = '55555555-5555-4555-8555-555555555555';

  beforeEach(async () => {
    service = {
      listSubmissions: jest.fn(),
      gradeEssay: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EssayGradingController, EssayAnswerGradingController],
      providers: [{ provide: EssayGradingService, useValue: service }],
    }).compile();

    controller = module.get(EssayGradingController);
    answerController = module.get(EssayAnswerGradingController);
  });

  it('delegates essay grading queue listing', async () => {
    const query = { courseId, status: EssayGradingStatusFilter.ALL };

    await controller.listSubmissions(instructorId, query);

    expect(service.listSubmissions).toHaveBeenCalledWith(instructorId, query);
  });

  it('delegates essay grade saving', async () => {
    const dto = { points: 8, feedback: 'Good answer' };

    await answerController.gradeEssay(
      courseId,
      quizId,
      attemptId,
      questionId,
      instructorId,
      dto,
    );

    expect(service.gradeEssay).toHaveBeenCalledWith(
      instructorId,
      courseId,
      quizId,
      attemptId,
      questionId,
      dto,
    );
  });
});

describe('EssayGrading RBAC', () => {
  const handlers = [
    EssayGradingController,
    EssayAnswerGradingController,
  ].flatMap((controllerClass) =>
    Object.getOwnPropertyNames(controllerClass.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => ({ target: controllerClass.prototype, name })),
  );

  it('keeps every essay grading endpoint restricted to Instructor', () => {
    for (const { target, name } of handlers) {
      const descriptor = Object.getOwnPropertyDescriptor(target, name)!;
      const fn = descriptor.value as (
        this: unknown,
        ...args: unknown[]
      ) => unknown;
      expect(Reflect.getMetadata(ROLES_KEY, fn)).toEqual([UserRole.INSTRUCTOR]);
    }
  });

  it('allows an Instructor through the guard and rejects others', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      EssayGradingController.prototype,
      'listSubmissions',
    )!.value;
    const buildContext = (user?: { id: string; role: UserRole }) => ({
      switchToHttp: () => ({ getRequest: <T>() => ({ user }) as T }),
      getHandler: () => handler,
      getClass: () => EssayGradingController,
    });

    expect(
      new RolesGuard(reflector).canActivate(
        buildContext({
          id: 'instructor-id',
          role: UserRole.INSTRUCTOR,
        }) as never,
      ),
    ).toBe(true);
    expect(() =>
      new RolesGuard(reflector).canActivate(buildContext(undefined) as never),
    ).toThrow(UnauthorizedException);
    expect(() =>
      new RolesGuard(reflector).canActivate(
        buildContext({ id: 'learner-id', role: UserRole.LEARNER }) as never,
      ),
    ).toThrow(ForbiddenException);
  });
});
