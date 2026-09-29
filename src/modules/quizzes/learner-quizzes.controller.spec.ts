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
import { SubmitQuizAttemptDto } from './dto/quiz-attempt.dto';
import { LearnerQuizzesController } from './learner-quizzes.controller';
import { QuizAttemptsService } from './quiz-attempts.service';

describe('LearnerQuizzesController', () => {
  let controller: LearnerQuizzesController;
  let service: {
    loadLearnerQuiz: jest.Mock;
    startAttempt: jest.Mock;
    submitAttempt: jest.Mock;
    listAttempts: jest.Mock;
  };

  const learnerId = '11111111-1111-4111-8111-111111111111';
  const courseId = '22222222-2222-4222-8222-222222222222';
  const lessonId = '33333333-3333-4333-8333-333333333333';
  const quizId = '44444444-4444-4444-8444-444444444444';
  const attemptId = '55555555-5555-4555-8555-555555555555';
  const questionId = '66666666-6666-4666-8666-666666666666';
  const handlerOf = (methodName: keyof LearnerQuizzesController) =>
    Object.getOwnPropertyDescriptor(
      LearnerQuizzesController.prototype,
      methodName,
    )!.value;

  beforeEach(async () => {
    service = {
      loadLearnerQuiz: jest.fn(),
      startAttempt: jest.fn(),
      submitAttempt: jest.fn(),
      listAttempts: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LearnerQuizzesController],
      providers: [{ provide: QuizAttemptsService, useValue: service }],
    }).compile();

    controller = module.get(LearnerQuizzesController);
  });

  it('delegates quiz loading to QuizAttemptsService', async () => {
    await controller.loadQuiz(courseId, lessonId, learnerId);

    expect(service.loadLearnerQuiz).toHaveBeenCalledWith(
      learnerId,
      courseId,
      lessonId,
    );
  });

  it('delegates attempt starting to QuizAttemptsService', async () => {
    await controller.startAttempt(courseId, lessonId, quizId, learnerId);

    expect(service.startAttempt).toHaveBeenCalledWith(
      learnerId,
      courseId,
      lessonId,
      quizId,
    );
  });

  it('delegates attempt submission to QuizAttemptsService', async () => {
    const dto: SubmitQuizAttemptDto = {
      answers: [{ questionId, selectedOptionIndexes: [0] }],
    };

    await controller.submitAttempt(
      courseId,
      lessonId,
      quizId,
      attemptId,
      learnerId,
      dto,
    );

    expect(service.submitAttempt).toHaveBeenCalledWith(
      learnerId,
      courseId,
      lessonId,
      quizId,
      attemptId,
      dto,
    );
  });

  it('delegates attempt history loading to QuizAttemptsService', async () => {
    await controller.listAttempts(courseId, lessonId, quizId, learnerId);

    expect(service.listAttempts).toHaveBeenCalledWith(
      learnerId,
      courseId,
      lessonId,
      quizId,
    );
  });

  it('keeps every learner quiz endpoint restricted to Learner', () => {
    for (const name of Object.getOwnPropertyNames(
      LearnerQuizzesController.prototype,
    ).filter((item) => item !== 'constructor')) {
      const descriptor = Object.getOwnPropertyDescriptor(
        LearnerQuizzesController.prototype,
        name,
      )!;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      expect(Reflect.getMetadata(ROLES_KEY, descriptor.value)).toEqual([
        UserRole.LEARNER,
      ]);
    }
  });

  it('caches learner quiz loading per user', () => {
    expect(Reflect.getMetadata(CACHE_METADATA, handlerOf('loadQuiz'))).toEqual({
      namespace: 'learning:quiz',
      ttl: 60,
      scope: 'user',
    });
  });

  it('caches learner quiz attempt history per user', () => {
    expect(
      Reflect.getMetadata(CACHE_METADATA, handlerOf('listAttempts')),
    ).toEqual({
      namespace: 'learning:quiz-attempts',
      ttl: 30,
      scope: 'user',
    });
  });

  it('invalidates learner quiz cache on attempt start', () => {
    expect(
      Reflect.getMetadata(CACHE_INVALIDATE_METADATA, handlerOf('startAttempt')),
    ).toEqual(['learning:quiz', 'learning:quiz-attempts', 'dashboard:learner']);
  });

  it('invalidates learner quiz, learning, and dashboard cache on submit', () => {
    expect(
      Reflect.getMetadata(
        CACHE_INVALIDATE_METADATA,
        handlerOf('submitAttempt'),
      ),
    ).toEqual([
      'learning:quiz',
      'learning:quiz-attempts',
      'learning:course',
      'learning:lesson',
      'dashboard:learner',
    ]);
  });
});

describe('LearnerQuizzes RBAC', () => {
  it('allows a Learner through the guard and rejects others', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      LearnerQuizzesController.prototype,
      'loadQuiz',
    )!.value;
    const buildContext = (user?: { id: string; role: UserRole }) => ({
      switchToHttp: () => ({ getRequest: <T>() => ({ user }) as T }),
      getHandler: () => handler,
      getClass: () => LearnerQuizzesController,
    });

    expect(
      new RolesGuard(reflector).canActivate(
        buildContext({
          id: 'learner-id',
          role: UserRole.LEARNER,
        }) as never,
      ),
    ).toBe(true);

    expect(() =>
      new RolesGuard(reflector).canActivate(buildContext(undefined) as never),
    ).toThrow(UnauthorizedException);
    expect(() =>
      new RolesGuard(reflector).canActivate(
        buildContext({
          id: 'instructor-id',
          role: UserRole.INSTRUCTOR,
        }) as never,
      ),
    ).toThrow(ForbiddenException);
  });
});
