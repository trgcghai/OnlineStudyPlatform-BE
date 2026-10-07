import { Injectable } from '@nestjs/common';
import { EntityManager, In, IsNull, Not } from 'typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { LessonProgress } from '../learning/entities/lesson-progress.entity';
import { Quiz } from '../quizzes/entities/quiz.entity';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { QuizAttemptStatus } from '../quizzes/dto/quiz-attempt.dto';

@Injectable()
export class CertificateEligibilityService {
  async getEligibleEnrollment(
    manager: EntityManager,
    learnerId: string,
    courseId: string,
  ): Promise<Enrollment | null> {
    const enrollment = await manager.getRepository(Enrollment).findOne({
      where: { learnerId, courseId },
      relations: { learner: true, course: true },
    });
    if (
      !enrollment ||
      Number(enrollment.progress) !== 100 ||
      !enrollment.completedAt
    )
      return null;

    const lessons = await manager
      .getRepository(Lesson)
      .find({ where: { courseId } });
    if (lessons.length === 0) return null;
    const lessonIds = lessons.map((lesson) => lesson.id);
    const [progressRows, quizzes] = await Promise.all([
      manager.getRepository(LessonProgress).find({
        where: {
          learnerId,
          courseId,
          lessonId: In(lessonIds),
          watchCompletedAt: Not(IsNull()),
          lessonCompletedAt: Not(IsNull()),
        },
      }),
      manager.getRepository(Quiz).find({ where: { lessonId: In(lessonIds) } }),
    ]);
    const completedIds = new Set(progressRows.map((row) => row.lessonId));
    if (lessons.some((lesson) => !completedIds.has(lesson.id))) return null;
    if (quizzes.length === 0) return enrollment;

    const attempts = await manager.getRepository(QuizAttempt).find({
      where: {
        learnerId,
        quizId: In(quizzes.map((quiz) => quiz.id)),
        passed: true,
        status: QuizAttemptStatus.PASSED,
        pendingEssayCount: 0,
        submittedAt: Not(IsNull()),
      },
    });
    const passedIds = new Set(attempts.map((attempt) => attempt.quizId));
    return quizzes.every((quiz) => passedIds.has(quiz.id)) ? enrollment : null;
  }
}
