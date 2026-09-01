import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';

import {
  Course,
  CourseLearningOrder,
  CourseStatus,
} from '../../modules/courses/entities/course.entity';
import {
  User,
  UserRole,
  UserStatus,
} from '../../modules/users/entities/user.entity';
import { LessonQuizSeed } from './lessonQuiz.seed';

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

const UNSPLASH_COURSE_THUMBNAILS = [
  'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1605379399642-870262d3d051?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1509228627152-72ae9ae6848d?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1558655146-9f40138edfeb?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1522542550221-31fd19575a2d?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1462899006636-339e08d1844e?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=960&q=80',
  'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?auto=format&fit=crop&w=960&q=80',
] as const;

const SAMPLE_COURSES = [
  [
    'Next.js Foundations',
    'Programming',
    CourseStatus.PUBLISHED,
    CourseLearningOrder.SEQUENTIAL,
  ],
  [
    'NestJS API Design',
    'Programming',
    CourseStatus.PUBLISHED,
    CourseLearningOrder.FREE,
  ],
  [
    'TypeScript For Web Apps',
    'Programming',
    CourseStatus.DRAFT,
    CourseLearningOrder.SEQUENTIAL,
  ],
  [
    'React Performance Patterns',
    'Programming',
    CourseStatus.PENDING,
    CourseLearningOrder.FREE,
  ],
  [
    'Advanced JavaScript',
    'Programming',
    CourseStatus.REJECTED,
    CourseLearningOrder.SEQUENTIAL,
  ],
  [
    'Docker For Developers',
    'Programming',
    CourseStatus.PUBLISHED,
    CourseLearningOrder.FREE,
  ],

  [
    'PostgreSQL Essentials',
    'Data',
    CourseStatus.PUBLISHED,
    CourseLearningOrder.SEQUENTIAL,
  ],
  [
    'MongoDB Practical Guide',
    'Data',
    CourseStatus.PENDING,
    CourseLearningOrder.FREE,
  ],
  [
    'Redis Caching Patterns',
    'Data',
    CourseStatus.DRAFT,
    CourseLearningOrder.SEQUENTIAL,
  ],
  [
    'SQL Query Optimization',
    'Data',
    CourseStatus.REJECTED,
    CourseLearningOrder.FREE,
  ],
  [
    'Data Visualization Basics',
    'Data',
    CourseStatus.PUBLISHED,
    CourseLearningOrder.SEQUENTIAL,
  ],
  [
    'Introduction To Data Analytics',
    'Data',
    CourseStatus.PENDING,
    CourseLearningOrder.FREE,
  ],

  [
    'UI Design Fundamentals',
    'Design',
    CourseStatus.PUBLISHED,
    CourseLearningOrder.SEQUENTIAL,
  ],
  [
    'Design Systems In Practice',
    'Design',
    CourseStatus.PENDING,
    CourseLearningOrder.FREE,
  ],
  [
    'Figma To Frontend Workflow',
    'Design',
    CourseStatus.DRAFT,
    CourseLearningOrder.SEQUENTIAL,
  ],
  [
    'UX Research Essentials',
    'Design',
    CourseStatus.REJECTED,
    CourseLearningOrder.FREE,
  ],
  [
    'Responsive Web Design',
    'Design',
    CourseStatus.PUBLISHED,
    CourseLearningOrder.SEQUENTIAL,
  ],
  [
    'Mobile App Design Basics',
    'Design',
    CourseStatus.DRAFT,
    CourseLearningOrder.FREE,
  ],

  [
    'Startup Business Basics',
    'Business',
    CourseStatus.PUBLISHED,
    CourseLearningOrder.SEQUENTIAL,
  ],
  [
    'Product Management 101',
    'Business',
    CourseStatus.PENDING,
    CourseLearningOrder.FREE,
  ],
  [
    'Digital Marketing Launchpad',
    'Business',
    CourseStatus.DRAFT,
    CourseLearningOrder.SEQUENTIAL,
  ],
  [
    'Entrepreneurship Fundamentals',
    'Business',
    CourseStatus.REJECTED,
    CourseLearningOrder.FREE,
  ],

  [
    'English For Interviews',
    'Language',
    CourseStatus.PUBLISHED,
    CourseLearningOrder.SEQUENTIAL,
  ],
  [
    'Business English Writing',
    'Language',
    CourseStatus.PENDING,
    CourseLearningOrder.FREE,
  ],
  [
    'IELTS Reading Practice',
    'Language',
    CourseStatus.DRAFT,
    CourseLearningOrder.SEQUENTIAL,
  ],
  [
    'English Presentation Skills',
    'Language',
    CourseStatus.REJECTED,
    CourseLearningOrder.FREE,
  ],

  [
    'Career Planning Workshop',
    'Other',
    CourseStatus.DRAFT,
    CourseLearningOrder.SEQUENTIAL,
  ],
  [
    'Learning How To Learn',
    'Other',
    CourseStatus.PUBLISHED,
    CourseLearningOrder.FREE,
  ],
  [
    'Time Management Essentials',
    'Other',
    CourseStatus.PENDING,
    CourseLearningOrder.SEQUENTIAL,
  ],
  [
    'Personal Productivity Basics',
    'Other',
    CourseStatus.REJECTED,
    CourseLearningOrder.FREE,
  ],
] as const;

@Injectable()
export class SampleDataSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger(SampleDataSeed.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    private readonly lessonQuizSeed: LessonQuizSeed,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedUsers();
    const instructorId = await this.seedCourses();
    if (instructorId) {
      await this.lessonQuizSeed.seedLessonsAndQuizzes(instructorId);
    }
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

  private async seedCourses(): Promise<string | null> {
    const instructor = await this.usersRepository.findOneBy({
      email: SAMPLE_INSTRUCTOR_EMAIL,
    });

    if (!instructor) {
      this.logger.warn('Sample instructor was not found; skipped course seed');
      return null;
    }

    const existingCourseCount = await this.coursesRepository.count({
      where: { instructorId: instructor.id },
    });

    if (existingCourseCount >= SAMPLE_COURSES.length) {
      return instructor.id;
    }

    if (existingCourseCount > 0) {
      await this.coursesRepository.delete({ instructorId: instructor.id });
    }

    const courses = SAMPLE_COURSES.map(
      ([title, category, status, learningOrder], index) =>
        this.coursesRepository.create({
          title,
          description:
            `Sample course ${index + 1} for manual testing course CRUD, ` +
            'filtering, pagination, statuses, and thumbnails.',
          category,
          thumbnail: UNSPLASH_COURSE_THUMBNAILS[index],
          status,
          learningOrder,
          instructorId: instructor.id,
          rejectReason:
            status === CourseStatus.REJECTED ? 'Sample reject reason' : null,
        }),
    );

    await this.coursesRepository.save(courses);
    this.logger.log(`Created ${courses.length} sample courses`);

    return instructor.id;
  }
}
