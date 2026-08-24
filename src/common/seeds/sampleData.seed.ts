import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';

import {
  Course,
  CourseStatus,
} from '../../modules/courses/entities/course.entity';
import {
  User,
  UserRole,
  UserStatus,
} from '../../modules/users/entities/user.entity';

const SAMPLE_PASSWORD = 'Abc@1234';
const SAMPLE_INSTRUCTOR_EMAIL = 'instructor@gmail.com';

const SAMPLE_USERS = [
  {
    name: 'System Admin',
    email: 'admin@gmail.com',
    role: UserRole.ADMIN,
  },
  {
    name: 'Sample Learner',
    email: 'learner@gmail.com',
    role: UserRole.LEARNER,
  },
  {
    name: 'Sample Instructor',
    email: SAMPLE_INSTRUCTOR_EMAIL,
    role: UserRole.INSTRUCTOR,
  },
] as const;

const SAMPLE_COURSES = [
  ['Next.js Foundations', 'Programming', CourseStatus.PUBLISHED],
  ['NestJS API Design', 'Programming', CourseStatus.PUBLISHED],
  ['TypeScript For Web Apps', 'Programming', CourseStatus.DRAFT],
  ['React Performance Patterns', 'Programming', CourseStatus.PENDING],
  ['Advanced JavaScript', 'Programming', CourseStatus.REJECTED],
  ['Docker For Developers', 'Programming', CourseStatus.PUBLISHED],

  ['PostgreSQL Essentials', 'Data', CourseStatus.PUBLISHED],
  ['MongoDB Practical Guide', 'Data', CourseStatus.PENDING],
  ['Redis Caching Patterns', 'Data', CourseStatus.DRAFT],
  ['SQL Query Optimization', 'Data', CourseStatus.REJECTED],
  ['Data Visualization Basics', 'Data', CourseStatus.PUBLISHED],
  ['Introduction To Data Analytics', 'Data', CourseStatus.PENDING],

  ['UI Design Fundamentals', 'Design', CourseStatus.PUBLISHED],
  ['Design Systems In Practice', 'Design', CourseStatus.PENDING],
  ['Figma To Frontend Workflow', 'Design', CourseStatus.DRAFT],
  ['UX Research Essentials', 'Design', CourseStatus.REJECTED],
  ['Responsive Web Design', 'Design', CourseStatus.PUBLISHED],
  ['Mobile App Design Basics', 'Design', CourseStatus.DRAFT],

  ['Startup Business Basics', 'Business', CourseStatus.PUBLISHED],
  ['Product Management 101', 'Business', CourseStatus.PENDING],
  ['Digital Marketing Launchpad', 'Business', CourseStatus.DRAFT],
  ['Entrepreneurship Fundamentals', 'Business', CourseStatus.REJECTED],

  ['English For Interviews', 'Language', CourseStatus.PUBLISHED],
  ['Business English Writing', 'Language', CourseStatus.PENDING],
  ['IELTS Reading Practice', 'Language', CourseStatus.DRAFT],
  ['English Presentation Skills', 'Language', CourseStatus.REJECTED],

  ['Career Planning Workshop', 'Other', CourseStatus.DRAFT],
  ['Learning How To Learn', 'Other', CourseStatus.PUBLISHED],
  ['Time Management Essentials', 'Other', CourseStatus.PENDING],
  ['Personal Productivity Basics', 'Other', CourseStatus.REJECTED],
] as const;

@Injectable()
export class SampleDataSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger(SampleDataSeed.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedUsers();
    await this.seedCourses();
  }

  private async seedUsers(): Promise<void> {
    const password = await bcrypt.hash(SAMPLE_PASSWORD, 10);

    for (const sampleUser of SAMPLE_USERS) {
      const email = sampleUser.email.trim().toLowerCase();
      const existingUser = await this.usersRepository.findOneBy({ email });

      if (existingUser) {
        continue;
      }

      const user = this.usersRepository.create({
        name: sampleUser.name,
        email,
        password,
        role: sampleUser.role,
        avatar: null,
        status: UserStatus.ACTIVE,
      });

      await this.usersRepository.save(user);
      this.logger.log(`Created sample user: ${email}`);
    }
  }

  private async seedCourses(): Promise<void> {
    const instructor = await this.usersRepository.findOneBy({
      email: SAMPLE_INSTRUCTOR_EMAIL,
    });

    if (!instructor) {
      this.logger.warn('Sample instructor was not found; skipped course seed');
      return;
    }

    const existingCourseCount = await this.coursesRepository.count({
      where: { instructorId: instructor.id },
    });

    if (existingCourseCount >= SAMPLE_COURSES.length) {
      return;
    }

    if (existingCourseCount > 0) {
      await this.coursesRepository.delete({ instructorId: instructor.id });
    }

    const courses = SAMPLE_COURSES.map(([title, category, status], index) =>
      this.coursesRepository.create({
        title,
        description:
          `Sample course ${index + 1} for manual testing course CRUD, ` +
          'filtering, pagination, statuses, and thumbnails.',
        category,
        thumbnail: `https://picsum.photos/seed/lms-course-${index + 1}/960/540`,
        status,
        instructorId: instructor.id,
        rejectReason:
          status === CourseStatus.REJECTED ? 'Sample reject reason' : null,
      }),
    );

    await this.coursesRepository.save(courses);
    this.logger.log(`Created ${courses.length} sample courses`);
  }
}
