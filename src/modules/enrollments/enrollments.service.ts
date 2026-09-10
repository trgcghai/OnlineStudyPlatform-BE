import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import { LessonProgress } from '../learning/entities/lesson-progress.entity';
import { QuizAttemptStatus } from '../quizzes/dto/quiz-attempt.dto';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import {
  CourseEnrollmentCompletionStatus,
  CourseEnrollmentListItemResponse,
  CourseEnrollmentListResponse,
  CourseEnrollmentQuizSummaryResponse,
  EnrollmentCourseResponse,
  EnrollmentResponse,
  ListCourseEnrollmentsQueryDto,
} from './dto/enrollment.dto';
import { Enrollment } from './entities/enrollment.entity';

const DUPLICATE_ENROLLMENT_ERROR = 'Bạn đã đăng ký khóa học này';
const PUBLISHED_ONLY_ERROR = 'Chỉ có thể đăng ký khóa học đã xuất bản';
const PAID_ENROLLMENT_REQUIRES_PAYMENT_ERROR =
  'Khóa học trả phí. Vui lòng hoàn tất thanh toán trước khi truy cập nội dung.';
const FREE_COURSE_PRICE = 0;

interface LessonActivityRaw {
  learnerId: string;
  lastLessonActivityAt: Date | string | null;
}

interface QuizSummaryRaw {
  learnerId: string;
  bestScore: string | number | null;
  latestAttemptAt: Date | string | null;
  passedCount: string | number | null;
  attemptCount: string | number | null;
}

@Injectable()
export class EnrollmentsService {
  constructor(
    @InjectRepository(Enrollment)
    private readonly enrollmentsRepository: Repository<Enrollment>,
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    @InjectRepository(LessonProgress)
    private readonly lessonProgressRepository: Repository<LessonProgress>,
    @InjectRepository(QuizAttempt)
    private readonly quizAttemptsRepository: Repository<QuizAttempt>,
  ) {}

  async enroll(
    learnerId: string,
    courseId: string,
  ): Promise<EnrollmentResponse> {
    const course = await this.coursesRepository.findOne({
      where: { id: courseId },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.status !== CourseStatus.PUBLISHED) {
      throw new BadRequestException(PUBLISHED_ONLY_ERROR);
    }

    if (course.price > FREE_COURSE_PRICE) {
      throw new HttpException(
        PAID_ENROLLMENT_REQUIRES_PAYMENT_ERROR,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const existingEnrollment = await this.enrollmentsRepository.findOne({
      where: { learnerId, courseId },
    });

    if (existingEnrollment) {
      throw new ConflictException(DUPLICATE_ENROLLMENT_ERROR);
    }

    const enrollment = this.enrollmentsRepository.create({
      learnerId,
      courseId,
      progress: '0.00',
      completedAt: null,
    });

    try {
      const savedEnrollment = await this.enrollmentsRepository.save(enrollment);
      return this.toEnrollmentResponse(savedEnrollment);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(DUPLICATE_ENROLLMENT_ERROR);
      }
      throw error;
    }
  }

  async findMine(learnerId: string): Promise<EnrollmentResponse[]> {
    const enrollments = await this.enrollmentsRepository.find({
      where: { learnerId },
      relations: { course: { instructor: true } },
      order: { enrolledAt: 'DESC' },
    });

    return enrollments.map((enrollment) =>
      this.toEnrollmentResponse(enrollment),
    );
  }

  async findCourseEnrollmentsForInstructor(
    instructorId: string,
    courseId: string,
    query: ListCourseEnrollmentsQueryDto,
  ): Promise<CourseEnrollmentListResponse> {
    await this.assertCourseOwnership(instructorId, courseId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const queryBuilder = this.enrollmentsRepository
      .createQueryBuilder('enrollment')
      .leftJoinAndSelect('enrollment.learner', 'learner')
      .where('enrollment.courseId = :courseId', { courseId });

    if (query.q) {
      queryBuilder.andWhere(
        '(LOWER(learner.name) LIKE :q OR LOWER(learner.email) LIKE :q)',
        { q: `%${query.q.toLowerCase()}%` },
      );
    }

    const [enrollments, total] = await queryBuilder
      .orderBy('enrollment.enrolledAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    if (enrollments.length === 0) {
      return {
        items: [],
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      };
    }

    const learnerIds = enrollments.map((enrollment) => enrollment.learnerId);
    const [lessonActivityByLearner, quizSummaryByLearner] = await Promise.all([
      this.getLessonActivityByLearner(courseId, learnerIds),
      this.getQuizSummaryByLearner(courseId, learnerIds),
    ]);

    return {
      items: enrollments.map((enrollment) =>
        this.toCourseEnrollmentListItem(
          enrollment,
          lessonActivityByLearner,
          quizSummaryByLearner,
        ),
      ),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async isLearnerEnrolled(
    learnerId: string,
    courseId: string,
  ): Promise<boolean> {
    return this.enrollmentsRepository.exists({
      where: { learnerId, courseId },
    });
  }

  private async assertCourseOwnership(
    instructorId: string,
    courseId: string,
  ): Promise<Course> {
    const course = await this.coursesRepository.findOne({
      where: { id: courseId },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.instructorId !== instructorId) {
      throw new ForbiddenException('You do not own this course');
    }

    return course;
  }

  private async getLessonActivityByLearner(
    courseId: string,
    learnerIds: string[],
  ): Promise<Map<string, Date>> {
    const rows = await this.lessonProgressRepository
      .createQueryBuilder('progress')
      .select('progress.learnerId', 'learnerId')
      .addSelect('MAX(progress.updatedAt)', 'lastLessonActivityAt')
      .where('progress.courseId = :courseId', { courseId })
      .andWhere('progress.learnerId IN (:...learnerIds)', { learnerIds })
      .groupBy('progress.learnerId')
      .getRawMany<LessonActivityRaw>();

    return new Map(
      rows
        .filter((row) => row.lastLessonActivityAt)
        .map((row) => [
          row.learnerId,
          new Date(row.lastLessonActivityAt as Date | string),
        ]),
    );
  }

  private async getQuizSummaryByLearner(
    courseId: string,
    learnerIds: string[],
  ): Promise<Map<string, CourseEnrollmentQuizSummaryResponse>> {
    const rows = await this.quizAttemptsRepository
      .createQueryBuilder('attempt')
      .leftJoin('attempt.quiz', 'quiz')
      .leftJoin('quiz.lesson', 'lesson')
      .select('attempt.learnerId', 'learnerId')
      .addSelect('MAX(CAST(attempt.score AS numeric))', 'bestScore')
      .addSelect(
        'MAX(COALESCE(attempt.submitted_at, attempt.updated_at))',
        'latestAttemptAt',
      )
      .addSelect(
        'SUM(CASE WHEN attempt.passed = true THEN 1 ELSE 0 END)',
        'passedCount',
      )
      .addSelect('COUNT(attempt.id)', 'attemptCount')
      .where('lesson.courseId = :courseId', { courseId })
      .andWhere('attempt.learnerId IN (:...learnerIds)', { learnerIds })
      .andWhere('attempt.status IN (:...completedStatuses)', {
        completedStatuses: [
          QuizAttemptStatus.PASSED,
          QuizAttemptStatus.NOT_PASSED,
        ],
      })
      .groupBy('attempt.learnerId')
      .getRawMany<QuizSummaryRaw>();

    return new Map(
      rows.map((row) => {
        const attemptCount = Number(row.attemptCount ?? 0);
        const passedCount = Number(row.passedCount ?? 0);

        return [
          row.learnerId,
          {
            bestScore:
              row.bestScore === null || row.bestScore === undefined
                ? null
                : Number(row.bestScore),
            latestAttemptAt: row.latestAttemptAt
              ? new Date(row.latestAttemptAt)
              : null,
            passed: attemptCount === 0 ? null : passedCount > 0,
          },
        ];
      }),
    );
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    );
  }

  private toCourseEnrollmentListItem(
    enrollment: Enrollment,
    lessonActivityByLearner: Map<string, Date>,
    quizSummaryByLearner: Map<string, CourseEnrollmentQuizSummaryResponse>,
  ): CourseEnrollmentListItemResponse {
    const lessonActivityAt = lessonActivityByLearner.get(enrollment.learnerId);
    const quizSummary = quizSummaryByLearner.get(enrollment.learnerId) ?? {
      bestScore: null,
      latestAttemptAt: null,
      passed: null,
    };

    return {
      enrollmentId: enrollment.id,
      learner: {
        id: enrollment.learner.id,
        name: enrollment.learner.name,
        email: enrollment.learner.email,
      },
      enrolledAt: enrollment.enrolledAt,
      progress: enrollment.progress,
      completionStatus: this.getCompletionStatus(enrollment),
      completedAt: enrollment.completedAt,
      lastActivityAt: this.getLatestDate(
        lessonActivityAt ?? null,
        quizSummary.latestAttemptAt,
      ),
      quizSummary,
    };
  }

  private getCompletionStatus(
    enrollment: Enrollment,
  ): CourseEnrollmentCompletionStatus {
    const progress = Number(enrollment.progress);

    if (enrollment.completedAt || progress >= 100) {
      return 'completed';
    }

    if (progress > 0) {
      return 'in_progress';
    }

    return 'not_started';
  }

  private getLatestDate(...dates: Array<Date | null>): Date | null {
    const timestamps = dates
      .filter((date): date is Date => Boolean(date))
      .map((date) => date.getTime());

    if (timestamps.length === 0) {
      return null;
    }

    return new Date(Math.max(...timestamps));
  }

  private toEnrollmentResponse(enrollment: Enrollment): EnrollmentResponse {
    return {
      id: enrollment.id,
      learnerId: enrollment.learnerId,
      courseId: enrollment.courseId,
      progress: enrollment.progress,
      enrolledAt: enrollment.enrolledAt,
      completedAt: enrollment.completedAt,
      updatedAt: enrollment.updatedAt,
      course: enrollment.course
        ? this.toEnrollmentCourseResponse(enrollment.course)
        : undefined,
    };
  }

  private toEnrollmentCourseResponse(course: Course): EnrollmentCourseResponse {
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      category: course.category,
      price: course.price,
      thumbnail: course.thumbnail,
      instructorId: course.instructorId,
      instructor: course.instructor
        ? {
            id: course.instructor.id,
            name: course.instructor.name,
          }
        : undefined,
    };
  }
}
