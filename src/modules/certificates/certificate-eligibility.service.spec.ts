import { EntityManager } from 'typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { LessonProgress } from '../learning/entities/lesson-progress.entity';
import { Quiz } from '../quizzes/entities/quiz.entity';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { QuizAttemptStatus } from '../quizzes/dto/quiz-attempt.dto';
import { CertificateEligibilityService } from './certificate-eligibility.service';

describe('Certificate eligibility', () => {
  const service = new CertificateEligibilityService();
  const enrollment = { progress: '100.00', completedAt: new Date() };
  const repositories = new Map<
    unknown,
    { find: jest.Mock; findOne: jest.Mock }
  >();
  const manager = {
    getRepository: (entity: unknown) => repositories.get(entity),
  } as unknown as EntityManager;

  beforeEach(() => {
    for (const entity of [
      Enrollment,
      Lesson,
      LessonProgress,
      Quiz,
      QuizAttempt,
    ])
      repositories.set(entity, { find: jest.fn(), findOne: jest.fn() });
    repositories.get(Enrollment)!.findOne.mockResolvedValue({ ...enrollment });
    repositories
      .get(Lesson)!
      .find.mockResolvedValue([{ id: 'lesson-1' }, { id: 'lesson-2' }]);
    repositories
      .get(LessonProgress)!
      .find.mockResolvedValue([
        { lessonId: 'lesson-1' },
        { lessonId: 'lesson-2' },
      ]);
    repositories.get(Quiz)!.find.mockResolvedValue([]);
  });

  it('accepts completed lessons without quizzes', async () => {
    expect(
      await service.getEligibleEnrollment(manager, 'learner', 'course'),
    ).toEqual(enrollment);
  });

  it.each([
    null,
    { progress: '99.99', completedAt: new Date() },
    { progress: '100', completedAt: null },
    { progress: 'invalid', completedAt: new Date() },
  ])('rejects missing or incomplete enrollment %p', async (value) => {
    repositories.get(Enrollment)!.findOne.mockResolvedValue(value);
    expect(
      await service.getEligibleEnrollment(manager, 'learner', 'course'),
    ).toBeNull();
  });

  it('does not certify an empty course', async () => {
    repositories.get(Lesson)!.find.mockResolvedValue([]);
    expect(
      await service.getEligibleEnrollment(manager, 'learner', 'course'),
    ).toBeNull();
  });

  it('does not let duplicate/stale progress substitute for a missing lesson', async () => {
    repositories
      .get(LessonProgress)!
      .find.mockResolvedValue([
        { lessonId: 'lesson-1' },
        { lessonId: 'lesson-1' },
        { lessonId: 'deleted' },
      ]);
    expect(
      await service.getEligibleEnrollment(manager, 'learner', 'course'),
    ).toBeNull();
  });

  it('requires a submitted PASSED attempt for every quiz', async () => {
    repositories
      .get(Quiz)!
      .find.mockResolvedValue([{ id: 'quiz-1' }, { id: 'quiz-2' }]);
    repositories
      .get(QuizAttempt)!
      .find.mockResolvedValue([{ quizId: 'quiz-1' }, { quizId: 'quiz-1' }]);
    expect(
      await service.getEligibleEnrollment(manager, 'learner', 'course'),
    ).toBeNull();
    expect(repositories.get(QuizAttempt)!.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          learnerId: 'learner',
          passed: true,
          status: QuizAttemptStatus.PASSED,
          pendingEssayCount: 0,
          submittedAt: expect.anything(),
        }),
      }),
    );
    repositories
      .get(QuizAttempt)!
      .find.mockResolvedValue([{ quizId: 'quiz-1' }, { quizId: 'quiz-2' }]);
    expect(
      await service.getEligibleEnrollment(manager, 'learner', 'course'),
    ).toEqual(enrollment);
  });
});
