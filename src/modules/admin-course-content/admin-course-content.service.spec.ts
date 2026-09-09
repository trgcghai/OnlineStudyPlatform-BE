import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { Question, QuestionType } from '../quizzes/entities/question.entity';
import { Quiz } from '../quizzes/entities/quiz.entity';
import { AdminCourseContentService } from './admin-course-content.service';

function createMockRepository<T>(overrides: Partial<Repository<T>> = {}) {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as Repository<T>;
}

describe('AdminCourseContentService', () => {
  let service: AdminCourseContentService;
  let coursesRepo: ReturnType<typeof createMockRepository<Course>>;
  let lessonsRepo: ReturnType<typeof createMockRepository<Lesson>>;
  let quizzesRepo: ReturnType<typeof createMockRepository<Quiz>>;
  let questionsRepo: ReturnType<typeof createMockRepository<Question>>;

  const courseId = randomUUID();
  const instructorId = randomUUID();

  function makeCourse(overrides: Partial<Course> = {}): Course {
    const course = new Course();
    course.id = courseId;
    course.title = 'Test Course';
    course.description = 'Description';
    course.category = 'Programming';
    course.thumbnail = null;
    course.status = CourseStatus.PENDING;
    course.rejectReason = null;
    course.instructorId = instructorId;
    course.createdAt = new Date();
    course.updatedAt = new Date();
    return Object.assign(course, overrides);
  }

  function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
    const lesson = new Lesson();
    lesson.id = randomUUID();
    lesson.title = 'Lesson 1';
    lesson.description = '';
    lesson.videoUrl = null;
    lesson.materialUrl = null;
    lesson.duration = 0;
    lesson.position = 0;
    lesson.courseId = courseId;
    lesson.createdAt = new Date();
    lesson.updatedAt = new Date();
    return Object.assign(lesson, overrides);
  }

  function makeQuiz(overrides: Partial<Quiz> = {}): Quiz {
    const quiz = new Quiz();
    quiz.id = randomUUID();
    quiz.lessonId = randomUUID();
    quiz.title = 'Quiz 1';
    quiz.description = '';
    quiz.timeLimitMinutes = 10;
    quiz.passScore = 70;
    quiz.createdAt = new Date();
    quiz.updatedAt = new Date();
    return Object.assign(quiz, overrides);
  }

  function makeQuestion(overrides: Partial<Question> = {}): Question {
    const question = new Question();
    question.id = randomUUID();
    question.quizId = randomUUID();
    question.content = 'Question?';
    question.type = QuestionType.MCQ;
    question.options = ['A', 'B'];
    question.correctAnswers = [0];
    question.points = 5;
    question.position = 0;
    question.createdAt = new Date();
    question.updatedAt = new Date();
    return Object.assign(question, overrides);
  }

  beforeEach(async () => {
    coursesRepo = createMockRepository();
    lessonsRepo = createMockRepository();
    quizzesRepo = createMockRepository();
    questionsRepo = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminCourseContentService,
        { provide: getRepositoryToken(Course), useValue: coursesRepo },
        { provide: getRepositoryToken(Lesson), useValue: lessonsRepo },
        { provide: getRepositoryToken(Quiz), useValue: quizzesRepo },
        { provide: getRepositoryToken(Question), useValue: questionsRepo },
      ],
    }).compile();

    service = module.get(AdminCourseContentService);
  });

  it('returns lessons with their quiz summaries when a quiz exists', async () => {
    const lesson = makeLesson();
    const quiz = makeQuiz({ lessonId: lesson.id });
    const question = makeQuestion({ quizId: quiz.id, points: 5 });

    coursesRepo.findOne = jest.fn().mockResolvedValue(makeCourse());
    lessonsRepo.find = jest.fn().mockResolvedValue([lesson]);
    quizzesRepo.find = jest.fn().mockResolvedValue([quiz]);
    questionsRepo.find = jest.fn().mockResolvedValue([question]);

    const result = await service.listLessonsWithQuizzes(courseId);

    expect(result.total).toBe(1);
    expect(result.courseId).toBe(courseId);
    expect(result.courseTitle).toBe('Test Course');
    expect(result.items[0]).toMatchObject({
      lesson: { id: lesson.id, title: lesson.title, courseId },
      quiz: {
        id: quiz.id,
        lessonId: lesson.id,
        courseId,
        questionCount: 1,
        totalPoints: 5,
        passScorePoints: 4,
        passScore: 70,
      },
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(questionsRepo.find).toHaveBeenCalledTimes(1);
    const questionQuery = (questionsRepo.find as jest.Mock).mock
      .calls[0][0] as { where: { quizId: { _value: string[] } } };
    expect(questionQuery.where.quizId._value).toEqual([quiz.id]);
  });

  it('returns a null quiz for a lesson without a quiz', async () => {
    const lesson = makeLesson();

    coursesRepo.findOne = jest.fn().mockResolvedValue(makeCourse());
    lessonsRepo.find = jest.fn().mockResolvedValue([lesson]);
    quizzesRepo.find = jest.fn().mockResolvedValue([]);

    const result = await service.listLessonsWithQuizzes(courseId);

    expect(result.total).toBe(1);
    expect(result.items[0].quiz).toBeNull();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(questionsRepo.find).not.toHaveBeenCalled();
  });

  it('returns an empty list when the course has no lessons', async () => {
    coursesRepo.findOne = jest.fn().mockResolvedValue(makeCourse());
    lessonsRepo.find = jest.fn().mockResolvedValue([]);

    const result = await service.listLessonsWithQuizzes(courseId);

    expect(result).toEqual({
      items: [],
      total: 0,
      courseId,
      courseTitle: 'Test Course',
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(quizzesRepo.find).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the course does not exist', async () => {
    coursesRepo.findOne = jest.fn().mockResolvedValue(null);

    await expect(service.listLessonsWithQuizzes(courseId)).rejects.toThrow(
      NotFoundException,
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(lessonsRepo.find).not.toHaveBeenCalled();
  });
});
