import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import {
  EnrollmentCourseResponse,
  EnrollmentResponse,
} from './dto/enrollment.dto';
import { Enrollment } from './entities/enrollment.entity';

const DUPLICATE_ENROLLMENT_ERROR = 'Bạn đã đăng ký khóa học này';
const PUBLISHED_ONLY_ERROR = 'Chỉ có thể đăng ký khóa học đã xuất bản';

@Injectable()
export class EnrollmentsService {
  constructor(
    @InjectRepository(Enrollment)
    private readonly enrollmentsRepository: Repository<Enrollment>,
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
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

  async isLearnerEnrolled(
    learnerId: string,
    courseId: string,
  ): Promise<boolean> {
    return this.enrollmentsRepository.exists({
      where: { learnerId, courseId },
    });
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    );
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
