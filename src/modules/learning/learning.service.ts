import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LessonSummary,
  LessonSummaryStatus,
} from '../ai-summary/entities/lesson-summary.entity';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { LearningAccessService } from '../lessons/learning-access.service';
import {
  LearningCourseResponse,
  LearningCourseSummaryResponse,
  LearningEnrollmentResponse,
  LearningLessonDetailResponse,
  LearningLessonAiSummaryResponse,
  LearningLessonSummaryResponse,
} from './dto/learning.dto';
import { LearningProgressService } from './learning-progress.service';

export const LEARNING_ENROLLMENT_REQUIRED_MESSAGE =
  'Bạn cần đăng ký khóa học để học nội dung này';

@Injectable()
export class LearningService {
  constructor(
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    @InjectRepository(Lesson)
    private readonly lessonsRepository: Repository<Lesson>,
    @InjectRepository(LessonSummary)
    private readonly summariesRepository: Repository<LessonSummary>,
    @InjectRepository(Enrollment)
    private readonly enrollmentsRepository: Repository<Enrollment>,
    private readonly learningAccessService: LearningAccessService,
    private readonly learningProgressService: LearningProgressService,
  ) {}

  async getCourseLearning(
    learnerId: string,
    courseId: string,
  ): Promise<LearningCourseResponse> {
    const { course, enrollment, lessons } = await this.loadLearningContext(
      learnerId,
      courseId,
    );
    const completedLessonIds =
      await this.learningProgressService.getCompletedLessonIds(
        learnerId,
        courseId,
      );
    const lessonSummaries = this.toLessonSummaries(
      course,
      lessons,
      completedLessonIds,
    );

    return {
      course: this.toCourseSummary(course),
      enrollment: this.toEnrollmentSummary(enrollment),
      lessons: lessonSummaries,
      firstAccessibleLessonId:
        lessonSummaries.find((lesson) => lesson.isAccessible)?.id ?? null,
    };
  }

  async getLessonLearning(
    learnerId: string,
    courseId: string,
    lessonId: string,
  ): Promise<LearningLessonDetailResponse> {
    const { course, lessons } = await this.loadLearningContext(
      learnerId,
      courseId,
    );
    const lesson = await this.lessonsRepository.findOne({
      where: { id: lessonId, courseId },
    });

    if (!lesson || lesson.courseId !== courseId) {
      throw new NotFoundException('Lesson not found');
    }

    const completedLessonIds =
      await this.learningProgressService.getCompletedLessonIds(
        learnerId,
        courseId,
      );

    const decision = this.learningAccessService.determineLessonAccess(
      course.learningOrder,
      lesson,
      lessons,
      completedLessonIds,
    );

    if (!decision.allowed) {
      throw new ForbiddenException(decision.message);
    }

    return {
      ...this.toLessonSummary(course, lesson, lessons, completedLessonIds),
      courseId: lesson.courseId,
      videoUrl: lesson.videoUrl,
      materialUrl: lesson.materialUrl,
    };
  }

  async getLessonSummary(
    learnerId: string,
    courseId: string,
    lessonId: string,
  ): Promise<LearningLessonAiSummaryResponse> {
    const { course, lessons } = await this.loadLearningContext(
      learnerId,
      courseId,
    );
    const lesson = await this.lessonsRepository.findOne({
      where: { id: lessonId, courseId },
    });
    if (!lesson || lesson.courseId !== courseId) {
      throw new NotFoundException('Lesson not found');
    }

    const completedLessonIds =
      await this.learningProgressService.getCompletedLessonIds(
        learnerId,
        courseId,
      );
    const decision = this.learningAccessService.determineLessonAccess(
      course.learningOrder,
      lesson,
      lessons,
      completedLessonIds,
    );
    if (!decision.allowed) {
      throw new ForbiddenException(decision.message);
    }

    const summary = await this.summariesRepository.findOne({
      where: { lessonId: lesson.id },
    });

    return {
      lessonId: lesson.id,
      status: summary?.status ?? LessonSummaryStatus.PENDING,
      summaryText: summary?.summaryText ?? null,
      updatedAt: summary?.updatedAt ?? null,
    };
  }

  private async loadLearningContext(learnerId: string, courseId: string) {
    const course = await this.coursesRepository.findOne({
      where: { id: courseId },
    });

    if (!course || course.status !== CourseStatus.PUBLISHED) {
      throw new NotFoundException('Course not found');
    }

    const enrollment = await this.enrollmentsRepository.findOne({
      where: { learnerId, courseId },
    });

    if (!enrollment) {
      throw new ForbiddenException(LEARNING_ENROLLMENT_REQUIRED_MESSAGE);
    }

    const lessons = await this.lessonsRepository.find({
      where: { courseId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });

    return { course, enrollment, lessons };
  }

  private toLessonSummaries(
    course: Course,
    lessons: Lesson[],
    completedLessonIds: ReadonlySet<string>,
  ): LearningLessonSummaryResponse[] {
    return lessons.map((lesson) =>
      this.toLessonSummary(course, lesson, lessons, completedLessonIds),
    );
  }

  private toLessonSummary(
    course: Course,
    lesson: Lesson,
    lessons: Lesson[],
    completedLessonIds: ReadonlySet<string>,
  ): LearningLessonSummaryResponse {
    const decision = this.learningAccessService.determineLessonAccess(
      course.learningOrder,
      lesson,
      lessons,
      completedLessonIds,
    );

    return {
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      duration: lesson.duration,
      position: lesson.position,
      isAccessible: decision.allowed,
      isCompleted: completedLessonIds.has(lesson.id),
      blockedReason: decision.allowed ? null : decision.message,
    };
  }

  private toCourseSummary(course: Course): LearningCourseSummaryResponse {
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      thumbnail: course.thumbnail,
      learningOrder: course.learningOrder,
    };
  }

  private toEnrollmentSummary(
    enrollment: Enrollment,
  ): LearningEnrollmentResponse {
    return {
      id: enrollment.id,
      progress: enrollment.progress,
      enrolledAt: enrollment.enrolledAt,
      completedAt: enrollment.completedAt,
    };
  }
}
