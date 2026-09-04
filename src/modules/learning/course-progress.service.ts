import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { QuizAttemptStatus } from '../quizzes/dto/quiz-attempt.dto';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { Quiz } from '../quizzes/entities/quiz.entity';
import { LessonProgress } from './entities/lesson-progress.entity';

@Injectable()
export class CourseProgressService {
  constructor(
    @InjectRepository(Enrollment)
    private readonly enrollmentsRepository: Repository<Enrollment>,
    @InjectRepository(Lesson)
    private readonly lessonsRepository: Repository<Lesson>,
    @InjectRepository(LessonProgress)
    private readonly progressRepository: Repository<LessonProgress>,
    @InjectRepository(Quiz)
    private readonly quizzesRepository: Repository<Quiz>,
    @InjectRepository(QuizAttempt)
    private readonly quizAttemptsRepository: Repository<QuizAttempt>,
  ) {}

  async recomputeEnrollmentProgress(
    learnerId: string,
    courseId: string,
  ): Promise<Enrollment> {
    const enrollment = await this.enrollmentsRepository.findOne({
      where: { learnerId, courseId },
    });

    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    const [totalLessons, completedLessons] = await Promise.all([
      this.lessonsRepository.count({ where: { courseId } }),
      this.progressRepository.count({
        where: { learnerId, courseId, lessonCompletedAt: Not(IsNull()) },
      }),
    ]);
    const progress =
      totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0;

    enrollment.progress = progress.toFixed(2);
    enrollment.completedAt =
      progress >= 100 ? (enrollment.completedAt ?? new Date()) : null;

    return this.enrollmentsRepository.save(enrollment);
  }

  async recomputeCourseEnrollmentsProgress(courseId: string): Promise<void> {
    const enrollments = await this.enrollmentsRepository.find({
      where: { courseId },
    });

    await Promise.all(
      enrollments.map((enrollment) =>
        this.recomputeEnrollmentProgress(enrollment.learnerId, courseId),
      ),
    );
  }

  async refreshLessonCompletion(
    learnerId: string,
    lessonId: string,
  ): Promise<LessonProgress | null> {
    const progress = await this.progressRepository.findOne({
      where: { learnerId, lessonId },
    });

    if (!progress?.watchCompletedAt) return progress;

    const requiredActivitiesComplete = await this.areRequiredActivitiesComplete(
      learnerId,
      lessonId,
    );
    const nextCompletedAt = requiredActivitiesComplete
      ? (progress.lessonCompletedAt ?? new Date())
      : null;

    if (progress.lessonCompletedAt?.getTime() === nextCompletedAt?.getTime()) {
      return progress;
    }

    progress.lessonCompletedAt = nextCompletedAt;
    return this.progressRepository.save(progress);
  }

  async refreshLessonCompletionsForLesson(lessonId: string): Promise<void> {
    const progressRows = await this.progressRepository.find({
      where: { lessonId },
    });

    await Promise.all(
      progressRows.map((progress) =>
        this.refreshLessonCompletion(progress.learnerId, lessonId),
      ),
    );
  }

  private async areRequiredActivitiesComplete(
    learnerId: string,
    lessonId: string,
  ): Promise<boolean> {
    const quiz = await this.quizzesRepository.findOne({ where: { lessonId } });
    if (!quiz) return true;

    const passedAttempts = await this.quizAttemptsRepository.count({
      where: {
        learnerId,
        quizId: quiz.id,
        passed: true,
        status: QuizAttemptStatus.PASSED,
        submittedAt: Not(IsNull()),
      },
    });

    return passedAttempts > 0;
  }
}
