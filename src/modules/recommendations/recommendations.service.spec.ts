import { Repository } from 'typeorm';
import {
  Course,
  CourseLearningOrder,
  CourseStatus,
} from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { LessonProgress } from '../learning/entities/lesson-progress.entity';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { AiRecommendationsClient } from './ai-recommendations.client';
import { RecommendationsService } from './recommendations.service';

type MockRepository<T> = Partial<Record<keyof Repository<T>, jest.Mock>>;

function mockRepository<T>(): MockRepository<T> {
  return {
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: 'course-a',
    title: 'Course A',
    description: 'Description A',
    category: 'Backend',
    price: 0,
    thumbnail: null,
    status: CourseStatus.PUBLISHED,
    learningOrder: CourseLearningOrder.FREE,
    completionThresholdPercent: '90.00',
    rejectReason: null,
    instructorId: 'instructor-1',
    instructor: {
      id: 'instructor-1',
      name: 'Instructor A',
    } as Course['instructor'],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeEnrollment(overrides: Partial<Enrollment> = {}): Enrollment {
  return {
    id: 'enrollment-1',
    learnerId: 'learner-1',
    courseId: 'course-enrolled',
    learner: undefined as never,
    course: makeCourse({ id: 'course-enrolled', category: 'Backend' }),
    enrolledAt: new Date('2026-01-02T00:00:00.000Z'),
    completedAt: null,
    progress: '0.00',
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function makeCandidateQueryBuilder(
  courses: Course[],
  popularityRows: Array<{ courseId: string; count: string }>,
) {
  const qb = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(courses),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(popularityRows),
  };
  return qb;
}

describe('RecommendationsService', () => {
  let coursesRepository: MockRepository<Course>;
  let enrollmentsRepository: MockRepository<Enrollment>;
  let analyticsRepository: MockRepository<LearningAnalyticsEvent>;
  let lessonProgressRepository: MockRepository<LessonProgress>;
  let quizAttemptsRepository: MockRepository<QuizAttempt>;
  let aiGateway: { recommend: jest.Mock };
  let service: RecommendationsService;

  beforeEach(() => {
    coursesRepository = mockRepository<Course>();
    enrollmentsRepository = mockRepository<Enrollment>();
    analyticsRepository = mockRepository<LearningAnalyticsEvent>();
    lessonProgressRepository = mockRepository<LessonProgress>();
    quizAttemptsRepository = mockRepository<QuizAttempt>();
    aiGateway = { recommend: jest.fn().mockResolvedValue(null) };

    service = new RecommendationsService(
      coursesRepository as Repository<Course>,
      enrollmentsRepository as Repository<Enrollment>,
      analyticsRepository as Repository<LearningAnalyticsEvent>,
      lessonProgressRepository as Repository<LessonProgress>,
      quizAttemptsRepository as Repository<QuizAttempt>,
      aiGateway as unknown as AiRecommendationsClient,
    );
  });

  it('returns popular published non-enrolled courses for learner without history using stable tie-breakers', async () => {
    enrollmentsRepository.find?.mockResolvedValue([]);
    analyticsRepository.find?.mockResolvedValue([]);
    lessonProgressRepository.find?.mockResolvedValue([]);
    quizAttemptsRepository.find?.mockResolvedValue([]);
    const courses = [
      makeCourse({ id: 'course-b', title: 'Beta', category: 'Design' }),
      makeCourse({ id: 'course-a', title: 'Alpha', category: 'Backend' }),
      makeCourse({ id: 'course-c', title: 'Alpha', category: 'Frontend' }),
    ];
    coursesRepository.createQueryBuilder?.mockReturnValue(
      makeCandidateQueryBuilder(courses, []),
    );
    enrollmentsRepository.createQueryBuilder?.mockReturnValue(
      makeCandidateQueryBuilder(
        [],
        [
          { courseId: 'course-b', count: '3' },
          { courseId: 'course-a', count: '3' },
          { courseId: 'course-c', count: '1' },
        ],
      ),
    );

    const result = await service.getRecommendations('learner-1', 3);

    expect(result.map((course) => course.id)).toEqual([
      'course-a',
      'course-b',
      'course-c',
    ]);
  });

  it('does not return enrolled courses or unpublished courses', async () => {
    enrollmentsRepository.find?.mockResolvedValue([
      makeEnrollment({ courseId: 'course-enrolled' }),
    ]);
    analyticsRepository.find?.mockResolvedValue([]);
    lessonProgressRepository.find?.mockResolvedValue([]);
    quizAttemptsRepository.find?.mockResolvedValue([]);
    const courses = [makeCourse({ id: 'course-open', title: 'Open Course' })];
    const qb = makeCandidateQueryBuilder(courses, [
      { courseId: 'course-open', count: '1' },
    ]);
    coursesRepository.createQueryBuilder?.mockReturnValue(qb);
    enrollmentsRepository.createQueryBuilder?.mockReturnValue(
      makeCandidateQueryBuilder([], [{ courseId: 'course-open', count: '1' }]),
    );

    const result = await service.getRecommendations('learner-1', 8);

    expect(qb.where).toHaveBeenCalledWith('course.status = :status', {
      status: CourseStatus.PUBLISHED,
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      'course.id NOT IN (:...enrolledCourseIds)',
      {
        enrolledCourseIds: ['course-enrolled'],
      },
    );
    expect(result.map((course) => course.id)).toEqual(['course-open']);
  });

  it('prioritizes candidate categories that match learner history', async () => {
    enrollmentsRepository.find?.mockResolvedValue([
      makeEnrollment({
        courseId: 'course-history',
        progress: '80.00',
        course: makeCourse({ id: 'course-history', category: 'Backend' }),
      }),
    ]);
    analyticsRepository.find?.mockResolvedValue([]);
    lessonProgressRepository.find?.mockResolvedValue([]);
    quizAttemptsRepository.find?.mockResolvedValue([]);
    const courses = [
      makeCourse({
        id: 'course-design',
        title: 'Design Systems',
        category: 'Design',
      }),
      makeCourse({
        id: 'course-backend',
        title: 'API Design',
        category: 'Backend',
      }),
    ];
    coursesRepository.createQueryBuilder?.mockReturnValue(
      makeCandidateQueryBuilder(courses, []),
    );
    enrollmentsRepository.createQueryBuilder?.mockReturnValue(
      makeCandidateQueryBuilder(
        [],
        [
          { courseId: 'course-design', count: '99' },
          { courseId: 'course-backend', count: '1' },
        ],
      ),
    );

    const result = await service.getRecommendations('learner-1', 2);

    expect(result.map((course) => course.id)).toEqual([
      'course-backend',
      'course-design',
    ]);
  });

  it('keeps category affinity ahead of very popular unrelated courses', async () => {
    enrollmentsRepository.find?.mockResolvedValue([
      makeEnrollment({
        courseId: 'course-history',
        progress: '10.00',
        course: makeCourse({ id: 'course-history', category: 'Backend' }),
      }),
    ]);
    analyticsRepository.find?.mockResolvedValue([]);
    lessonProgressRepository.find?.mockResolvedValue([]);
    quizAttemptsRepository.find?.mockResolvedValue([]);
    const courses = [
      makeCourse({ id: 'course-popular', title: 'Popular UX', category: 'UX' }),
      makeCourse({
        id: 'course-backend',
        title: 'Backend Basics',
        category: 'Backend',
      }),
    ];
    coursesRepository.createQueryBuilder?.mockReturnValue(
      makeCandidateQueryBuilder(courses, []),
    );
    enrollmentsRepository.createQueryBuilder?.mockReturnValue(
      makeCandidateQueryBuilder(
        [],
        [
          { courseId: 'course-popular', count: '1000' },
          { courseId: 'course-backend', count: '0' },
        ],
      ),
    );

    const result = await service.getRecommendations('learner-1', 2);

    expect(result.map((course) => course.id)).toEqual([
      'course-backend',
      'course-popular',
    ]);
  });

  it('uses valid AI order and fills invalid or duplicate output with heuristic results', async () => {
    enrollmentsRepository.find?.mockResolvedValue([
      makeEnrollment({
        courseId: 'course-history',
        course: makeCourse({ id: 'course-history', category: 'Backend' }),
      }),
    ]);
    analyticsRepository.find?.mockResolvedValue([]);
    lessonProgressRepository.find?.mockResolvedValue([]);
    quizAttemptsRepository.find?.mockResolvedValue([]);
    const courses = [
      makeCourse({ id: 'course-a', title: 'Alpha', category: 'Backend' }),
      makeCourse({ id: 'course-b', title: 'Beta', category: 'Backend' }),
      makeCourse({ id: 'course-c', title: 'Gamma', category: 'Design' }),
    ];
    coursesRepository.createQueryBuilder?.mockReturnValue(
      makeCandidateQueryBuilder(courses, []),
    );
    enrollmentsRepository.createQueryBuilder?.mockReturnValue(
      makeCandidateQueryBuilder(
        [],
        [
          { courseId: 'course-a', count: '5' },
          { courseId: 'course-b', count: '4' },
          { courseId: 'course-c', count: '3' },
        ],
      ),
    );
    aiGateway.recommend.mockResolvedValue({
      courseIds: ['missing', 'course-c', 'course-c', 'course-a'],
    });

    const result = await service.getRecommendations('learner-1', 3);

    expect(result.map((course) => course.id)).toEqual([
      'course-c',
      'course-a',
      'course-b',
    ]);
  });

  it('sends at most 20 heuristic-ranked candidates to AI', async () => {
    enrollmentsRepository.find?.mockResolvedValue([]);
    analyticsRepository.find?.mockResolvedValue([]);
    lessonProgressRepository.find?.mockResolvedValue([]);
    quizAttemptsRepository.find?.mockResolvedValue([]);
    const courses = Array.from({ length: 25 }, (_, index) => {
      const courseNumber = index + 1;
      return makeCourse({
        id: `course-${courseNumber.toString().padStart(2, '0')}`,
        title: `Course ${courseNumber.toString().padStart(2, '0')}`,
      });
    });
    coursesRepository.createQueryBuilder?.mockReturnValue(
      makeCandidateQueryBuilder(courses, []),
    );
    enrollmentsRepository.createQueryBuilder?.mockReturnValue(
      makeCandidateQueryBuilder(
        [],
        courses.map((course, index) => ({
          courseId: course.id,
          count: String(25 - index),
        })),
      ),
    );

    await service.getRecommendations('learner-1', 8);

    expect(aiGateway.recommend).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: courses.slice(0, 20).map((course, index) => ({
          id: course.id,
          title: course.title,
          category: course.category,
          description: course.description,
          popularity: 25 - index,
        })),
      }),
    );
  });
});
