import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { LessonProgress } from '../learning/entities/lesson-progress.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { QuizAttemptStatus } from '../quizzes/dto/quiz-attempt.dto';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import {
  LearnerDashboardBestQuizAttemptResponse,
  LearnerDashboardCourseResponse,
  LearnerDashboardRecentActivityResponse,
  LearnerDashboardResponse,
} from './dto/learner-dashboard.dto';

const RECENT_ACTIVITY_LIMIT = 5;

@Injectable()
export class LearnerDashboardService {
  constructor(
    @InjectRepository(Enrollment)
    private readonly enrollmentsRepository: Repository<Enrollment>,
    @InjectRepository(Lesson)
    private readonly lessonsRepository: Repository<Lesson>,
    @InjectRepository(LessonProgress)
    private readonly lessonProgressRepository: Repository<LessonProgress>,
    @InjectRepository(QuizAttempt)
    private readonly quizAttemptsRepository: Repository<QuizAttempt>,
    @InjectRepository(LearningAnalyticsEvent)
    private readonly analyticsEventsRepository: Repository<LearningAnalyticsEvent>,
  ) {}

  async getDashboard(learnerId: string): Promise<LearnerDashboardResponse> {
    const enrollments = await this.enrollmentsRepository.find({
      where: { learnerId },
      relations: { course: { instructor: true } },
      order: { enrolledAt: 'DESC' },
    });
    const ownedEnrollments = enrollments.filter(
      (enrollment) => enrollment.course,
    );
    const courseIds = ownedEnrollments.map((enrollment) => enrollment.courseId);

    if (courseIds.length === 0) {
      return this.emptyDashboard();
    }

    const [lessons, completedProgress, attempts, activities] =
      await Promise.all([
        this.lessonsRepository.find({
          where: { courseId: In(courseIds) },
          order: { position: 'ASC', createdAt: 'ASC' },
        }),
        this.lessonProgressRepository.find({
          where: {
            learnerId,
            courseId: In(courseIds),
            lessonCompletedAt: Not(IsNull()),
          },
        }),
        this.quizAttemptsRepository.find({
          where: {
            learnerId,
            status: In([
              QuizAttemptStatus.PASSED,
              QuizAttemptStatus.NOT_PASSED,
            ]),
            submittedAt: Not(IsNull()),
          },
          relations: { quiz: { lesson: true } },
        }),
        this.analyticsEventsRepository.find({
          where: { learnerId, courseId: In(courseIds) },
          order: { createdAt: 'DESC' },
          take: RECENT_ACTIVITY_LIMIT,
        }),
      ]);

    const lessonsByCourse = this.groupByCourseId(lessons);
    const completedLessonIdsByCourse =
      this.groupCompletedLessonIdsByCourse(completedProgress);
    const bestAttemptByCourse = this.getBestAttemptByCourse(
      attempts,
      courseIds,
      learnerId,
    );
    const courses = ownedEnrollments.map((enrollment) =>
      this.toCourseRow(
        enrollment,
        lessonsByCourse.get(enrollment.courseId) ?? [],
        completedLessonIdsByCourse.get(enrollment.courseId) ?? new Set(),
        bestAttemptByCourse.get(enrollment.courseId) ?? null,
      ),
    );

    return {
      summary: this.toSummary(courses),
      courses,
      recentActivities: this.toRecentActivities(
        activities,
        ownedEnrollments,
        lessons,
      ),
    };
  }

  private emptyDashboard(): LearnerDashboardResponse {
    return {
      summary: {
        enrolledCourseCount: 0,
        completedCourseCount: 0,
        averageProgressPercent: 0,
        averageQuizScorePercent: null,
      },
      courses: [],
      recentActivities: [],
    };
  }

  private toCourseRow(
    enrollment: Enrollment,
    lessons: Lesson[],
    completedLessonIds: ReadonlySet<string>,
    bestAttempt: LearnerDashboardBestQuizAttemptResponse | null,
  ): LearnerDashboardCourseResponse {
    const progressPercent = this.toPercent(enrollment.progress);
    const firstIncompleteLesson = lessons.find(
      (lesson) => !completedLessonIds.has(lesson.id),
    );
    const firstLesson = lessons[0] ?? null;
    const lessonId = (firstIncompleteLesson ?? firstLesson)?.id ?? null;

    return {
      enrollmentId: enrollment.id,
      courseId: enrollment.courseId,
      title: enrollment.course.title,
      thumbnail: enrollment.course.thumbnail,
      category: enrollment.course.category,
      instructorName: enrollment.course.instructor?.name ?? null,
      progressPercent,
      status:
        enrollment.completedAt || progressPercent >= 100
          ? 'completed'
          : 'in_progress',
      bestQuizScorePercent: bestAttempt
        ? this.roundPercent((bestAttempt.score / bestAttempt.totalPoints) * 100)
        : null,
      bestQuizAttempt: bestAttempt,
      continueLearning: {
        courseId: enrollment.courseId,
        lessonId,
        href: `/learner/courses/${enrollment.courseId}/learn`,
      },
    };
  }

  private groupByCourseId(lessons: Lesson[]): Map<string, Lesson[]> {
    const grouped = new Map<string, Lesson[]>();
    for (const lesson of lessons) {
      grouped.set(lesson.courseId, [
        ...(grouped.get(lesson.courseId) ?? []),
        lesson,
      ]);
    }
    return grouped;
  }

  private groupCompletedLessonIdsByCourse(
    progressRows: LessonProgress[],
  ): Map<string, Set<string>> {
    const grouped = new Map<string, Set<string>>();
    for (const progress of progressRows) {
      const lessonIds = grouped.get(progress.courseId) ?? new Set<string>();
      lessonIds.add(progress.lessonId);
      grouped.set(progress.courseId, lessonIds);
    }
    return grouped;
  }

  private getBestAttemptByCourse(
    attempts: QuizAttempt[],
    courseIds: string[],
    learnerId: string,
  ): Map<string, LearnerDashboardBestQuizAttemptResponse> {
    const allowedCourseIds = new Set(courseIds);
    const bestByCourse = new Map<
      string,
      LearnerDashboardBestQuizAttemptResponse
    >();

    for (const attempt of attempts) {
      const courseId = attempt.quiz?.lesson?.courseId;
      const totalPoints = Number(attempt.totalPoints);
      const score = Number(attempt.score);
      if (
        attempt.learnerId !== learnerId ||
        !courseId ||
        !allowedCourseIds.has(courseId) ||
        totalPoints <= 0 ||
        !attempt.submittedAt ||
        (attempt.status !== QuizAttemptStatus.PASSED &&
          attempt.status !== QuizAttemptStatus.NOT_PASSED)
      ) {
        continue;
      }

      const candidate = {
        quizId: attempt.quizId,
        attemptId: attempt.id,
        score,
        totalPoints,
        submittedAt: attempt.submittedAt,
        passed: attempt.passed,
      };
      const current = bestByCourse.get(courseId);
      if (
        !current ||
        score / totalPoints > current.score / current.totalPoints
      ) {
        bestByCourse.set(courseId, candidate);
      }
    }

    return bestByCourse;
  }

  private toRecentActivities(
    activities: LearningAnalyticsEvent[],
    enrollments: Enrollment[],
    lessons: Lesson[],
  ): LearnerDashboardRecentActivityResponse[] {
    const courseTitleById = new Map(
      enrollments.map((enrollment) => [
        enrollment.courseId,
        enrollment.course.title,
      ]),
    );
    const lessonTitleById = new Map(
      lessons.map((lesson) => [lesson.id, lesson.title]),
    );

    return activities
      .filter((activity) => courseTitleById.has(activity.courseId))
      .map((activity) => ({
        id: activity.id,
        courseId: activity.courseId,
        lessonId: activity.lessonId,
        courseTitle: courseTitleById.get(activity.courseId) as string,
        lessonTitle: activity.lessonId
          ? (lessonTitleById.get(activity.lessonId) ?? null)
          : null,
        eventType: activity.eventType,
        occurredAt: activity.createdAt,
      }));
  }

  private toSummary(courses: LearnerDashboardCourseResponse[]) {
    const quizScores = courses
      .map((course) => course.bestQuizScorePercent)
      .filter((score): score is number => score !== null);

    return {
      enrolledCourseCount: courses.length,
      completedCourseCount: courses.filter(
        (course) => course.status === 'completed',
      ).length,
      averageProgressPercent:
        courses.length > 0
          ? this.roundPercent(
              courses.reduce((sum, course) => sum + course.progressPercent, 0) /
                courses.length,
            )
          : 0,
      averageQuizScorePercent:
        quizScores.length > 0
          ? this.roundPercent(
              quizScores.reduce((sum, score) => sum + score, 0) /
                quizScores.length,
            )
          : null,
    };
  }

  private toPercent(value: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return this.roundPercent(Math.min(Math.max(parsed, 0), 100));
  }

  private roundPercent(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
