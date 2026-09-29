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
import { QuestionType } from './entities/question.entity';
import {
  QuestionManageController,
  QuizManageController,
  QuizQuestionsController,
  QuizzesController,
} from './quizzes.controller';
import { QuizzesService } from './quizzes.service';

describe('QuizzesController', () => {
  let quizzesController: QuizzesController;
  let quizQuestionsController: QuizQuestionsController;
  let quizManageController: QuizManageController;
  let questionManageController: QuestionManageController;
  let service: {
    create: jest.Mock;
    findByLesson: jest.Mock;
    addQuestion: jest.Mock;
    reorderQuestions: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    updateQuestion: jest.Mock;
    removeQuestion: jest.Mock;
  };

  const courseId = '33333333-3333-4333-8333-333333333333';
  const lessonId = '44444444-4444-4444-8444-444444444444';
  const quizId = '55555555-5555-4555-8555-555555555555';
  const questionId = '66666666-6666-4666-8666-666666666666';
  const instructorId = '11111111-1111-4111-8111-111111111111';
  const quizzesHandlerOf = (methodName: keyof QuizzesController): object =>
    Object.getOwnPropertyDescriptor(QuizzesController.prototype, methodName)!
      .value as object;
  const quizQuestionsHandlerOf = (
    methodName: keyof QuizQuestionsController,
  ): object =>
    Object.getOwnPropertyDescriptor(
      QuizQuestionsController.prototype,
      methodName,
    )!.value as object;
  const quizManageHandlerOf = (
    methodName: keyof QuizManageController,
  ): object =>
    Object.getOwnPropertyDescriptor(QuizManageController.prototype, methodName)!
      .value as object;
  const questionManageHandlerOf = (
    methodName: keyof QuestionManageController,
  ): object =>
    Object.getOwnPropertyDescriptor(
      QuestionManageController.prototype,
      methodName,
    )!.value as object;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findByLesson: jest.fn(),
      addQuestion: jest.fn(),
      reorderQuestions: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      updateQuestion: jest.fn(),
      removeQuestion: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [
        QuizzesController,
        QuizQuestionsController,
        QuizManageController,
        QuestionManageController,
      ],
      providers: [{ provide: QuizzesService, useValue: service }],
    }).compile();

    quizzesController = module.get(QuizzesController);
    quizQuestionsController = module.get(QuizQuestionsController);
    quizManageController = module.get(QuizManageController);
    questionManageController = module.get(QuestionManageController);
  });

  it('delegates quiz creation with course, lesson, and owner id', async () => {
    const dto = { title: 'Quiz', passScore: 70 };

    await quizzesController.create(courseId, lessonId, instructorId, dto);

    expect(service.create).toHaveBeenCalledWith(
      courseId,
      lessonId,
      instructorId,
      dto,
    );
  });

  it('delegates quiz retrieval for a lesson', async () => {
    await quizzesController.list(courseId, lessonId, instructorId);

    expect(service.findByLesson).toHaveBeenCalledWith(
      courseId,
      lessonId,
      instructorId,
    );
  });

  it('delegates adding a question to a quiz', async () => {
    const dto = {
      type: QuestionType.ESSAY,
      content: 'Essay',
      points: 10,
    };

    await quizQuestionsController.addQuestion(quizId, instructorId, dto);

    expect(service.addQuestion).toHaveBeenCalledWith(quizId, instructorId, dto);
  });

  it('delegates reordering questions by ordered ids', async () => {
    const dto = { orderedIds: ['a', 'b'] };

    await quizQuestionsController.reorder(quizId, instructorId, dto);

    expect(service.reorderQuestions).toHaveBeenCalledWith(
      quizId,
      instructorId,
      dto,
    );
  });

  it('delegates quiz get, update, and delete', async () => {
    await quizManageController.findOne(quizId, instructorId);
    await quizManageController.update(quizId, instructorId, {
      title: 'Renamed',
    });
    await quizManageController.remove(quizId, instructorId);

    expect(service.findOne).toHaveBeenCalledWith(quizId, instructorId);
    expect(service.update).toHaveBeenCalledWith(quizId, instructorId, {
      title: 'Renamed',
    });
    expect(service.remove).toHaveBeenCalledWith(quizId, instructorId);
  });

  it('delegates question update and delete', async () => {
    await questionManageController.update(questionId, instructorId, {
      points: 8,
    });
    await questionManageController.remove(questionId, instructorId);

    expect(service.updateQuestion).toHaveBeenCalledWith(
      questionId,
      instructorId,
      { points: 8 },
    );
    expect(service.removeQuestion).toHaveBeenCalledWith(
      questionId,
      instructorId,
    );
  });

  it('caches instructor quiz reads by current user', () => {
    expect(
      Reflect.getMetadata(CACHE_METADATA, quizzesHandlerOf('list')),
    ).toEqual({
      namespace: 'instructor:quizzes:list',
      ttl: 60,
      scope: 'user',
    });
    expect(
      Reflect.getMetadata(CACHE_METADATA, quizManageHandlerOf('findOne')),
    ).toEqual({
      namespace: 'instructor:quizzes:detail',
      ttl: 60,
      scope: 'user',
    });
  });

  it.each([
    ['create', quizzesHandlerOf('create')],
    ['importExcel', quizzesHandlerOf('importExcel')],
    ['update', quizManageHandlerOf('update')],
    ['remove', quizManageHandlerOf('remove')],
    ['addQuestion', quizQuestionsHandlerOf('addQuestion')],
    ['reorder', quizQuestionsHandlerOf('reorder')],
    ['updateQuestion', questionManageHandlerOf('update')],
    ['removeQuestion', questionManageHandlerOf('remove')],
  ])('invalidates instructor quiz cache on %s', (_handlerName, handler) => {
    expect(Reflect.getMetadata(CACHE_INVALIDATE_METADATA, handler)).toEqual([
      'instructor:quizzes:list',
      'instructor:quizzes:detail',
      'learning:quiz',
    ]);
  });
});

describe('Quizzes RBAC', () => {
  type Handler = { target: object; name: string };
  const handlers: Handler[] = [
    ...Object.getOwnPropertyNames(QuizzesController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => ({ target: QuizzesController.prototype, name })),
    ...Object.getOwnPropertyNames(QuizQuestionsController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => ({ target: QuizQuestionsController.prototype, name })),
    ...Object.getOwnPropertyNames(QuizManageController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => ({ target: QuizManageController.prototype, name })),
    ...Object.getOwnPropertyNames(QuestionManageController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => ({ target: QuestionManageController.prototype, name })),
  ];

  it('keeps every quiz endpoint restricted to Instructor', () => {
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
      QuizzesController.prototype,
      'create',
    )!.value;
    const buildContext = (user?: { id: string; role: UserRole }) => ({
      switchToHttp: () => ({ getRequest: <T>() => ({ user }) as T }),
      getHandler: () => handler,
      getClass: () => QuizzesController,
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
