import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { DataSource, In, Repository } from 'typeorm';

import { AppModule } from './../src/app.module';
import { Course } from '../src/modules/courses/entities/course.entity';
import { QuizAttempt } from '../src/modules/quizzes/entities/quiz-attempt.entity';
import { QuestionType } from '../src/modules/quizzes/entities/question.entity';
import { Quiz } from '../src/modules/quizzes/entities/quiz.entity';
import {
  ATTEMPTS_BLOCKED_DELETE_MESSAGE,
  ATTEMPTS_BLOCKED_PASS_SCORE_MESSAGE,
  ATTEMPTS_BLOCKED_QUESTION_MESSAGE,
} from '../src/modules/quizzes/quizzes.service';
import {
  User,
  UserRole,
  UserStatus,
} from './../src/modules/users/entities/user.entity';
import { App } from 'supertest/types';

type Envelope<T> = {
  success: boolean;
  statusCode: number;
  data: T;
  timestamp: string;
};

type ErrorEnvelope = {
  success: false;
  statusCode: number;
  data: null;
  error: { message: string };
};

describe('Quizzes (e2e)', () => {
  let app: INestApplication;
  let courseRepository: Repository<Course>;
  let quizRepository: Repository<Quiz>;
  let attemptRepository: Repository<QuizAttempt>;
  let userRepository: Repository<User>;
  let accessToken = '';
  let courseId = '';
  let lessonId = '';

  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  };

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = 'QuizE2e#123';
  const instructorEmail = `quiz-instructor-${suffix}@example.com`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const dataSource = app.get(DataSource);
    courseRepository = dataSource.getRepository(Course);
    quizRepository = dataSource.getRepository(Quiz);
    attemptRepository = dataSource.getRepository(QuizAttempt);
    userRepository = dataSource.getRepository(User);

    const hashedPassword = await bcrypt.hash(password, 10);
    await userRepository.save(
      userRepository.create({
        name: 'Quiz Instructor',
        email: instructorEmail,
        password: hashedPassword,
        role: UserRole.INSTRUCTOR,
        status: UserStatus.ACTIVE,
      }),
    );

    const loginRes = await request(app.getHttpServer() as App)
      .post('/auth/login')
      .send({ email: instructorEmail, password })
      .expect(200);
    const loginBody = loginRes.body as Envelope<{ accessToken: string }>;
    accessToken = loginBody.data.accessToken;
  });

  afterAll(async () => {
    if (courseId && quizRepository && attemptRepository) {
      const quizzes = await quizRepository.find({
        where: { lesson: { courseId } },
        select: { id: true },
      });
      const quizIds = quizzes.map((quiz) => quiz.id);
      if (quizIds.length > 0) {
        await attemptRepository.delete({ quizId: In(quizIds) });
      }
      await courseRepository.delete(courseId);
    }

    if (userRepository) {
      await userRepository.delete({ email: instructorEmail });
    }

    if (app) {
      await app.close();
    }

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const expectError = (
    body: ErrorEnvelope,
    statusCode: number,
    message: string,
  ): void => {
    expect(body).toMatchObject({
      success: false,
      statusCode,
      data: null,
      error: { message },
    });
  };

  it('creates a course and a lesson to host the quiz', async () => {
    const courseRes = await request(app.getHttpServer() as App)
      .post('/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Quiz Builder E2E',
        description: 'End-to-end quiz builder course',
        category: 'Programming',
      })
      .expect(201);
    const courseBody = courseRes.body as Envelope<{ id: string }>;
    courseId = courseBody.data.id;

    const lessonRes = await request(app.getHttpServer() as App)
      .post(`/courses/${courseId}/lessons`)
      .set('Authorization', `Bearer ${accessToken}`)
      .field('title', 'Quiz Lesson')
      .field('description', 'Lesson hosting the quiz')
      .expect(201);
    const lessonBody = lessonRes.body as Envelope<{ id: string }>;
    lessonId = lessonBody.data.id;

    expect(courseId).toMatch(/[0-9a-f-]{36}/);
    expect(lessonId).toMatch(/[0-9a-f-]{36}/);
  });

  it('POST quiz with 1 MCQ (5 pts) + 1 essay (10 pts), pass 70% → totalPoints 15, passScorePoints 11', async () => {
    const res = await request(app.getHttpServer() as App)
      .post(`/courses/${courseId}/lessons/${lessonId}/quiz`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Chapter 1 Quiz',
        description: 'Covers the whole chapter',
        timeLimitMinutes: 15,
        passScore: 70,
        questions: [
          {
            type: QuestionType.MCQ,
            content: 'Which options are correct?',
            options: ['A', 'B', 'C', 'D'],
            correctAnswers: [0, 2],
            points: 5,
          },
          {
            type: QuestionType.ESSAY,
            content: 'Explain the architecture',
            points: 10,
          },
        ],
      })
      .expect(201);

    const payload = res.body as Envelope<{
      id: string;
      title: string;
      passScore: number;
      totalPoints: number;
      passScorePoints: number;
      courseId: string;
      lessonId: string;
      questions: {
        id: string;
        type: QuestionType;
        points: number;
        position: number;
        options: string[];
        correctAnswers: number[];
      }[];
    }>;

    expect(payload.data).toMatchObject({
      title: 'Chapter 1 Quiz',
      description: 'Covers the whole chapter',
      timeLimitMinutes: 15,
      passScore: 70,
      totalPoints: 15,
      passScorePoints: 11,
      courseId,
      lessonId,
    });
    expect(payload.data.questions).toHaveLength(2);
    expect(payload.data.questions[0]).toMatchObject({
      type: QuestionType.MCQ,
      points: 5,
      position: 0,
      options: ['A', 'B', 'C', 'D'],
      correctAnswers: [0, 2],
    });
    expect(payload.data.questions[1]).toMatchObject({
      type: QuestionType.ESSAY,
      points: 10,
      position: 1,
      options: [],
    });
  });

  it('GET quiz list returns a summary with counts and total points', async () => {
    const res = await request(app.getHttpServer() as App)
      .get(`/courses/${courseId}/lessons/${lessonId}/quiz`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const payload = res.body as Envelope<
      {
        id: string;
        totalPoints: number;
        questionCount: number;
        passScorePoints: number;
      }[]
    >;

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({
      totalPoints: 15,
      questionCount: 2,
      passScorePoints: 11,
    });
  });

  it('edits quiz metadata and a question, adds one, then reorders them', async () => {
    const listRes = await request(app.getHttpServer() as App)
      .get(`/courses/${courseId}/lessons/${lessonId}/quiz`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const listBody = listRes.body as Envelope<{ id: string }[]>;
    const quizId = listBody.data[0].id;

    const detailRes = await request(app.getHttpServer() as App)
      .get(`/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const detailBody = detailRes.body as Envelope<{
      id: string;
      questions: { id: string; points: number }[];
    }>;
    const firstQuestionId = detailBody.data.questions[0].id;
    const secondQuestionId = detailBody.data.questions[1].id;

    await request(app.getHttpServer() as App)
      .patch(`/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Renamed quiz', timeLimitMinutes: 30 })
      .expect(200);

    await request(app.getHttpServer() as App)
      .patch(`/questions/${firstQuestionId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ points: 8 })
      .expect(200);

    const addRes = await request(app.getHttpServer() as App)
      .post(`/quizzes/${quizId}/questions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: QuestionType.ESSAY,
        content: 'Third essay question',
        points: 4,
      })
      .expect(201);
    const addBody = addRes.body as Envelope<{ id: string }>;
    const thirdQuestionId = addBody.data.id;

    await request(app.getHttpServer() as App)
      .patch(`/quizzes/${quizId}/questions/reorder`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        orderedIds: [thirdQuestionId, firstQuestionId, secondQuestionId],
      })
      .expect(200);

    const reorderedRes = await request(app.getHttpServer() as App)
      .get(`/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const reorderedBody = reorderedRes.body as Envelope<{
      totalPoints: number;
      questions: { id: string; position: number }[];
    }>;

    expect(reorderedBody.data.questions.map((q) => q.id)).toEqual([
      thirdQuestionId,
      firstQuestionId,
      secondQuestionId,
    ]);
    expect(reorderedBody.data.totalPoints).toBe(22);

    await request(app.getHttpServer() as App)
      .delete(`/questions/${firstQuestionId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const afterDeleteRes = await request(app.getHttpServer() as App)
      .get(`/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const afterDeleteBody = afterDeleteRes.body as Envelope<{
      questions: { id: string; position: number }[];
    }>;

    expect(afterDeleteBody.data.questions.map((q) => q.id)).toEqual([
      thirdQuestionId,
      secondQuestionId,
    ]);
    expect(afterDeleteBody.data.questions.map((q) => q.position)).toEqual([
      0, 1,
    ]);
  });

  it('blocks destructive changes once attempts exist, then allows delete after cleanup', async () => {
    const res = await request(app.getHttpServer() as App)
      .post(`/courses/${courseId}/lessons/${lessonId}/quiz`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Attempted Quiz',
        passScore: 70,
        questions: [
          {
            type: QuestionType.ESSAY,
            content: 'Manual grading sample',
            points: 10,
          },
        ],
      })
      .expect(201);
    const payload = res.body as Envelope<{ id: string }>;
    const quizId = payload.data.id;

    await attemptRepository.delete({ quizId });
    await attemptRepository.save(
      attemptRepository.create({
        quizId,
        learnerId: null,
        score: null,
        answers: null,
      }),
    );

    const deleteRes = await request(app.getHttpServer() as App)
      .delete(`/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(409);
    expectError(
      deleteRes.body as ErrorEnvelope,
      409,
      ATTEMPTS_BLOCKED_DELETE_MESSAGE,
    );

    const passScoreRes = await request(app.getHttpServer() as App)
      .patch(`/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ passScore: 80 })
      .expect(409);
    expectError(
      passScoreRes.body as ErrorEnvelope,
      409,
      ATTEMPTS_BLOCKED_PASS_SCORE_MESSAGE,
    );

    const addQuestionRes = await request(app.getHttpServer() as App)
      .post(`/quizzes/${quizId}/questions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: QuestionType.MCQ,
        content: 'Late question',
        options: ['A', 'B'],
        correctAnswers: [0],
        points: 5,
      })
      .expect(409);
    expectError(
      addQuestionRes.body as ErrorEnvelope,
      409,
      ATTEMPTS_BLOCKED_QUESTION_MESSAGE,
    );

    await attemptRepository.delete({ quizId });

    await request(app.getHttpServer() as App)
      .delete(`/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
  });

  it('rejects unauthenticated access to quiz routes', async () => {
    await request(app.getHttpServer() as App)
      .get(`/courses/${courseId}/lessons/${lessonId}/quiz`)
      .expect(401);
  });
});
