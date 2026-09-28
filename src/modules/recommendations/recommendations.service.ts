import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PublicCourseResponse } from '../courses/dto/course.dto';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { LessonProgress } from '../learning/entities/lesson-progress.entity';
import { QuizAttemptStatus } from '../quizzes/dto/quiz-attempt.dto';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import {
  RecommendationCandidate,
  RecommendationLearnerSignals,
} from './dto/recommendation.dto';
import { RecommendationsAiGateway } from './recommendations-ai.gateway';

const AI_RECOMMENDATION_CANDIDATE_LIMIT = 20;

@Injectable()
export class RecommendationsService {
  constructor(
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    @InjectRepository(Enrollment)
    private readonly enrollmentsRepository: Repository<Enrollment>,
    @InjectRepository(LearningAnalyticsEvent)
    private readonly analyticsEventsRepository: Repository<LearningAnalyticsEvent>,
    @InjectRepository(LessonProgress)
    private readonly lessonProgressRepository: Repository<LessonProgress>,
    @InjectRepository(QuizAttempt)
    private readonly quizAttemptsRepository: Repository<QuizAttempt>,
    private readonly aiGateway: RecommendationsAiGateway,
  ) {}

  async getRecommendations(
    learnerId: string,
    limit: number,
  ): Promise<PublicCourseResponse[]> {
    const normalizedLimit = Math.min(Math.max(limit, 1), 20);
    const enrollments = await this.enrollmentsRepository.find({
      where: { learnerId },
      relations: { course: true },
    });
    const enrolledCourseIds = enrollments.map(
      (enrollment) => enrollment.courseId,
    );
    const candidates = await this.loadCandidates(enrolledCourseIds);

    if (candidates.length === 0) {
      return [];
    }

    const popularityByCourseId = await this.loadPopularity(
      candidates.map((course) => course.id),
    );
    const signals = await this.loadSignals(learnerId, enrollments);
    const heuristicCourses = this.sortByHeuristic(
      candidates,
      signals,
      popularityByCourseId,
    );
    const aiCourseIds = await this.getAiCourseIds(
      learnerId,
      normalizedLimit,
      signals,
      heuristicCourses.slice(0, AI_RECOMMENDATION_CANDIDATE_LIMIT),
      popularityByCourseId,
    );
    const orderedCourses = this.mergeAiAndHeuristic(
      aiCourseIds,
      heuristicCourses,
    ).slice(0, normalizedLimit);

    return orderedCourses.map((course) => this.toPublicCourseResponse(course));
  }

  private async loadCandidates(enrolledCourseIds: string[]): Promise<Course[]> {
    const qb = this.coursesRepository
      .createQueryBuilder('course')
      .leftJoinAndSelect('course.instructor', 'instructor')
      .where('course.status = :status', { status: CourseStatus.PUBLISHED });

    if (enrolledCourseIds.length > 0) {
      qb.andWhere('course.id NOT IN (:...enrolledCourseIds)', {
        enrolledCourseIds,
      });
    }

    return qb.getMany();
  }

  private async loadPopularity(
    courseIds: string[],
  ): Promise<Map<string, number>> {
    if (courseIds.length === 0) return new Map();

    const rows = await this.enrollmentsRepository
      .createQueryBuilder('enrollment')
      .select('enrollment.courseId', 'courseId')
      .addSelect('COUNT(enrollment.id)', 'count')
      .where('enrollment.courseId IN (:...courseIds)', { courseIds })
      .groupBy('enrollment.courseId')
      .getRawMany<{ courseId: string; count: string }>();

    return new Map(rows.map((row) => [row.courseId, Number(row.count) || 0]));
  }

  private async loadSignals(
    learnerId: string,
    enrollments: Enrollment[],
  ): Promise<RecommendationLearnerSignals> {
    const enrolledCourseIds = enrollments.map(
      (enrollment) => enrollment.courseId,
    );
    const categories: Record<string, number> = {};
    const completedCourseIds: string[] = [];

    for (const enrollment of enrollments) {
      const category = enrollment.course?.category;
      if (!category) continue;

      const progress = Number(enrollment.progress) || 0;
      const boost =
        enrollment.completedAt || progress >= 100 ? 3 : progress >= 50 ? 2 : 1;
      categories[category] = (categories[category] ?? 0) + boost;
      if (enrollment.completedAt || progress >= 100) {
        completedCourseIds.push(enrollment.courseId);
      }
    }

    if (enrolledCourseIds.length === 0) {
      return {
        categories,
        completedCourseIds,
        engagementByCourseId: {},
        quizPerformanceByCourseId: {},
      };
    }

    const [events, progressRows, quizAttempts] = await Promise.all([
      this.analyticsEventsRepository.find({
        where: { learnerId, courseId: In(enrolledCourseIds) },
      }),
      this.lessonProgressRepository.find({
        where: { learnerId, courseId: In(enrolledCourseIds) },
      }),
      this.quizAttemptsRepository.find({
        where: {
          learnerId,
          status: In([QuizAttemptStatus.PASSED, QuizAttemptStatus.NOT_PASSED]),
        },
        relations: { quiz: { lesson: true } },
      }),
    ]);

    const engagementByCourseId: Record<string, number> = {};
    for (const event of events) {
      engagementByCourseId[event.courseId] =
        (engagementByCourseId[event.courseId] ?? 0) + 1;
    }
    for (const progress of progressRows) {
      engagementByCourseId[progress.courseId] =
        (engagementByCourseId[progress.courseId] ?? 0) +
        Number(progress.watchRatio ?? 0);
    }

    const quizPerformanceByCourseId: Record<string, number> = {};
    for (const attempt of quizAttempts) {
      const courseId = attempt.quiz?.lesson?.courseId;
      const score = Number(attempt.score);
      const totalPoints = Number(attempt.totalPoints);
      if (!courseId || totalPoints <= 0) continue;
      quizPerformanceByCourseId[courseId] = Math.max(
        quizPerformanceByCourseId[courseId] ?? 0,
        score / totalPoints,
      );
    }

    return {
      categories,
      completedCourseIds,
      engagementByCourseId,
      quizPerformanceByCourseId,
    };
  }

  private async getAiCourseIds(
    learnerId: string,
    limit: number,
    signals: RecommendationLearnerSignals,
    candidates: Course[],
    popularityByCourseId: ReadonlyMap<string, number>,
  ): Promise<string[]> {
    const aiResponse = await this.aiGateway.recommend({
      learnerId,
      limit,
      signals,
      candidates: candidates.map((course): RecommendationCandidate => ({
        id: course.id,
        title: course.title,
        category: course.category,
        description: course.description,
        popularity: popularityByCourseId.get(course.id) ?? 0,
      })),
    });

    return aiResponse?.courseIds ?? [];
  }

  private sortByHeuristic(
    candidates: Course[],
    signals: RecommendationLearnerSignals,
    popularityByCourseId: ReadonlyMap<string, number>,
  ): Course[] {
    return [...candidates].sort((left, right) => {
      const leftCategoryAffinity = signals.categories[left.category] ?? 0;
      const rightCategoryAffinity = signals.categories[right.category] ?? 0;
      if (rightCategoryAffinity !== leftCategoryAffinity) {
        return rightCategoryAffinity - leftCategoryAffinity;
      }

      const leftPopularity = popularityByCourseId.get(left.id) ?? 0;
      const rightPopularity = popularityByCourseId.get(right.id) ?? 0;
      if (rightPopularity !== leftPopularity) {
        return rightPopularity - leftPopularity;
      }

      const titleCompare = left.title.localeCompare(right.title);
      if (titleCompare !== 0) return titleCompare;
      return left.id.localeCompare(right.id);
    });
  }

  private mergeAiAndHeuristic(
    aiCourseIds: string[],
    heuristicCourses: Course[],
  ): Course[] {
    const candidatesById = new Map(
      heuristicCourses.map((course) => [course.id, course]),
    );
    const selected = new Set<string>();
    const ordered: Course[] = [];

    for (const courseId of aiCourseIds) {
      if (selected.has(courseId)) continue;
      const course = candidatesById.get(courseId);
      if (!course) continue;
      selected.add(courseId);
      ordered.push(course);
    }

    for (const course of heuristicCourses) {
      if (selected.has(course.id)) continue;
      selected.add(course.id);
      ordered.push(course);
    }

    return ordered;
  }

  private toPublicCourseResponse(course: Course): PublicCourseResponse {
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      category: course.category,
      price: course.price,
      thumbnail: course.thumbnail,
      learningOrder: course.learningOrder,
      instructorId: course.instructorId,
      instructor: course.instructor
        ? {
            id: course.instructor.id,
            name: course.instructor.name,
          }
        : undefined,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    };
  }
}
