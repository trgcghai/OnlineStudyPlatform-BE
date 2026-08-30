import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'crypto';
import { DataSource, ObjectLiteral, Repository } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import {
  CreateQuestionDto,
  CreateQuizDto,
  ReorderQuestionsDto,
} from './dto/quiz.dto';
import { Question, QuestionType } from './entities/question.entity';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { Quiz } from './entities/quiz.entity';
import {
  ATTEMPTS_BLOCKED_DELETE_MESSAGE,
  computePassScorePoints,
  QuizzesService,
} from './quizzes.service';

function makeCourse(overrides: Partial<Course> = {}): Course {
  const course = new Course();
  course.id = 'course-1';
  course.title = 'Test Course';
  course.description = 'Description';
  course.category = 'Programming';
  course.thumbnail = null;
  course.status = CourseStatus.DRAFT;
  course.rejectReason = null;
  course.instructorId = 'instructor-1';
  course.createdAt = new Date();
  course.updatedAt = new Date();
  return Object.assign(course, overrides);
}

function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
  const lesson = new Lesson();
  lesson.id = 'lesson-1';
  lesson.title = 'Test Lesson';
  lesson.description = '';
  lesson.videoUrl = null;
  lesson.materialUrl = null;
  lesson.duration = 0;
  lesson.position = 0;
  lesson.courseId = 'course-1';
  lesson.course = makeCourse({ id: 'course-1', instructorId: 'instructor-1' });
  lesson.createdAt = new Date();
  lesson.updatedAt = new Date();
  return Object.assign(lesson, overrides);
}

function makeQuiz(overrides: Partial<Quiz> = {}): Quiz {
  const quiz = new Quiz();
  quiz.id = 'quiz-1';
  quiz.lessonId = 'lesson-1';
  quiz.lesson = makeLesson({ id: 'lesson-1', courseId: 'course-1' });
  quiz.title = 'Test Quiz';
  quiz.description = '';
  quiz.timeLimitMinutes = 30;
  quiz.passScore = 70;
  quiz.questions = [];
  quiz.createdAt = new Date();
  quiz.updatedAt = new Date();
  return Object.assign(quiz, overrides);
}

function makeQuestion(overrides: Partial<Question> = {}): Question {
  const question = new Question();
  question.id = randomUUID();
  question.quizId = 'quiz-1';
  question.quiz = makeQuiz({ id: 'quiz-1' });
  question.type = QuestionType.MCQ;
  question.content = 'What is NestJS?';
  question.options = ['A framework', 'A language', 'A database', 'A cloud'];
  question.correctAnswers = [0];
  question.points = 5;
  question.position = 0;
  question.createdAt = new Date();
  question.updatedAt = new Date();
  return Object.assign(question, overrides);
}

function createMockRepository<T extends ObjectLiteral>(
  overrides: Partial<Record<keyof Repository<T>, jest.Mock>> = {},
) {
  return {
    find: jest.fn().mockResolvedValue([]),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    findOne: jest.fn().mockResolvedValue(null),
    maximum: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((entity) => entity as T),
    save: jest.fn((entity) => Promise.resolve(entity as T)),
    remove: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('QuizzesService', () => {
  let service: QuizzesService;
  let quizzesRepo: ReturnType<typeof createMockRepository<Quiz>>;
  let questionsRepo: ReturnType<typeof createMockRepository<Question>>;
  let attemptsRepo: ReturnType<typeof createMockRepository<QuizAttempt>>;
  let lessonsRepo: ReturnType<typeof createMockRepository<Lesson>>;
  let mockQueryRunner: {
    manager: { find: jest.Mock; update: jest.Mock };
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
  };

  const courseId = 'course-1';
  const lessonId = 'lesson-1';
  const instructorId = 'instructor-1';

  beforeEach(async () => {
    quizzesRepo = createMockRepository();
    questionsRepo = createMockRepository();
    attemptsRepo = createMockRepository();
    lessonsRepo = createMockRepository();
    const coursesRepo = createMockRepository<Course>();

    mockQueryRunner = {
      manager: {
        find: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizzesService,
        { provide: getRepositoryToken(Quiz), useValue: quizzesRepo },
        { provide: getRepositoryToken(Question), useValue: questionsRepo },
        { provide: getRepositoryToken(QuizAttempt), useValue: attemptsRepo },
        { provide: getRepositoryToken(Lesson), useValue: lessonsRepo },
        { provide: getRepositoryToken(Course), useValue: coursesRepo },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
          },
        },
      ],
    }).compile();

    service = module.get(QuizzesService);

    lessonsRepo.findOne.mockResolvedValue(makeLesson());
    quizzesRepo.findOne.mockResolvedValue(makeQuiz());
    questionsRepo.findOne.mockResolvedValue(makeQuestion());
  });

  describe('assertLessonOwnership', () => {
    it('should throw NotFoundException when lesson does not exist', async () => {
      lessonsRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assertLessonOwnership(courseId, lessonId, instructorId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when lesson is in another course', async () => {
      lessonsRepo.findOne.mockResolvedValue(
        makeLesson({ id: lessonId, courseId: 'other-course' }),
      );

      await expect(
        service.assertLessonOwnership(courseId, lessonId, instructorId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException when instructor does not own the course', async () => {
      lessonsRepo.findOne.mockResolvedValue(
        makeLesson({
          id: lessonId,
          course: makeCourse({ instructorId: 'other-instructor' }),
        }),
      );

      await expect(
        service.assertLessonOwnership(courseId, lessonId, instructorId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return the lesson when ownership is valid', async () => {
      const lesson = makeLesson();
      lessonsRepo.findOne.mockResolvedValue(lesson);

      const result = await service.assertLessonOwnership(
        courseId,
        lessonId,
        instructorId,
      );
      expect(result.id).toBe(lessonId);
    });
  });

  describe('create', () => {
    it('should create a quiz with the scenario 1 MCQ + 1 essay and compute total points', async () => {
      const mcq = {
        type: QuestionType.MCQ,
        content: 'MCQ question',
        options: ['A', 'B', 'C', 'D'],
        correctAnswers: [0],
        points: 5,
      };
      const essay = {
        type: QuestionType.ESSAY,
        content: 'Essay question',
        points: 10,
      };

      quizzesRepo.findOne.mockResolvedValue(
        makeQuiz({
          id: 'quiz-1',
          title: 'Scenario quiz',
          questions: [
            makeQuestion({
              id: 'q1',
              position: 0,
              points: 5,
              type: QuestionType.MCQ,
            }),
            makeQuestion({
              id: 'q2',
              position: 1,
              points: 10,
              type: QuestionType.ESSAY,
              options: [],
              correctAnswers: [],
            }),
          ],
        }),
      );
      quizzesRepo.save.mockResolvedValue(makeQuiz({ id: 'quiz-1' }));

      const result = await service.create(courseId, lessonId, instructorId, {
        title: 'Scenario quiz',
        passScore: 70,
        questions: [mcq, essay],
      });

      expect(result.totalPoints).toBe(15);
      expect(result.passScorePoints).toBe(11);
      expect(result.questions).toHaveLength(2);
      expect(result.courseId).toBe(courseId);

      const savedQuestions = questionsRepo.save.mock.calls[0][0] as Question[];
      expect(savedQuestions).toHaveLength(2);
      expect(savedQuestions[0]).toMatchObject({
        quizId: 'quiz-1',
        type: QuestionType.MCQ,
        points: 5,
        position: 0,
        correctAnswers: [0],
      });
      expect(savedQuestions[1]).toMatchObject({
        type: QuestionType.ESSAY,
        points: 10,
        position: 1,
        options: [],
        correctAnswers: [],
      });
    });

    it('should apply defaults (passScore 70, no time limit, empty description)', async () => {
      quizzesRepo.findOne.mockResolvedValue(makeQuiz({ id: 'quiz-1' }));

      await service.create(courseId, lessonId, instructorId, {
        title: 'Default quiz',
      });

      expect(quizzesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          lessonId,
          title: 'Default quiz',
          description: '',
          timeLimitMinutes: null,
          passScore: 70,
        }),
      );
    });

    it('should reject an MCQ question without options', async () => {
      await expect(
        service.create(courseId, lessonId, instructorId, {
          title: 'Bad quiz',
          questions: [
            {
              type: QuestionType.MCQ,
              content: 'No options',
              points: 5,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listByLesson', () => {
    it('should return summaries with counts and total points', async () => {
      quizzesRepo.find.mockResolvedValue([
        makeQuiz({ id: 'quiz-1' }),
        makeQuiz({ id: 'quiz-2', title: 'Second quiz' }),
      ]);
      questionsRepo.find.mockResolvedValue([
        makeQuestion({ quizId: 'quiz-1', points: 5 }),
        makeQuestion({ quizId: 'quiz-1', points: 10 }),
      ]);

      const result = await service.listByLesson(
        courseId,
        lessonId,
        instructorId,
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        courseId,
        questionCount: 2,
        totalPoints: 15,
        passScorePoints: 11,
      });
      expect(result[1]).toMatchObject({ questionCount: 0, totalPoints: 0 });

      expect(questionsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { quizId: expect.anything() } }),
      );
    });
  });

  describe('findOne', () => {
    it('should return the full quiz with sorted questions', async () => {
      quizzesRepo.findOne.mockResolvedValue(
        makeQuiz({
          questions: [
            makeQuestion({ id: 'q-late', position: 1, points: 5 }),
            makeQuestion({ id: 'q-early', position: 0, points: 10 }),
          ],
        }),
      );

      const result = await service.findOne('quiz-1', instructorId);

      expect(result.id).toBe('quiz-1');
      expect(result.questions.map((q) => q.id)).toEqual(['q-early', 'q-late']);
      expect(result.totalPoints).toBe(15);
    });

    it('should throw NotFoundException when quiz does not exist', async () => {
      quizzesRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing', instructorId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when quiz is not owned', async () => {
      quizzesRepo.findOne.mockResolvedValue(
        makeQuiz({
          lesson: makeLesson({
            course: makeCourse({ instructorId: 'other-instructor' }),
          }),
        }),
      );

      await expect(service.findOne('quiz-1', instructorId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('update', () => {
    it('should update quiz metadata and reload with questions', async () => {
      quizzesRepo.findOne.mockResolvedValue(
        makeQuiz({
          id: 'quiz-1',
          title: 'Updated',
          description: 'New description',
          timeLimitMinutes: 45,
          passScore: 80,
          questions: [],
        }),
      );

      const result = await service.update('quiz-1', instructorId, {
        title: 'Updated',
        description: 'New description',
        timeLimitMinutes: 45,
        passScore: 80,
      });

      expect(result.title).toBe('Updated');

      expect(quizzesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ passScore: 80 }),
      );
    });

    it('should block pass_score changes when attempts exist', async () => {
      attemptsRepo.count.mockResolvedValue(1);

      await expect(
        service.update('quiz-1', instructorId, { passScore: 80 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('should delete the quiz when there are no attempts', async () => {
      attemptsRepo.count.mockResolvedValue(0);

      await service.remove('quiz-1', instructorId);

      expect(quizzesRepo.remove).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'quiz-1' }),
      );
    });

    it('should block deleting a quiz that has attempts', async () => {
      attemptsRepo.count.mockResolvedValue(1);

      await expect(service.remove('quiz-1', instructorId)).rejects.toThrow(
        new ConflictException(ATTEMPTS_BLOCKED_DELETE_MESSAGE),
      );

      expect(quizzesRepo.remove).not.toHaveBeenCalled();
    });

    it('should convert a database FK violation into a ConflictException', async () => {
      attemptsRepo.count.mockResolvedValue(0);
      quizzesRepo.remove.mockRejectedValue({
        code: '23503',
        driverError: { code: '23503' },
      });

      await expect(service.remove('quiz-1', instructorId)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('addQuestion', () => {
    it('should append a question at the end of the quiz', async () => {
      questionsRepo.maximum.mockResolvedValue(2);

      const result = await service.addQuestion('quiz-1', instructorId, {
        type: QuestionType.MCQ,
        content: 'New question',
        options: ['Yes', 'No'],
        correctAnswers: [1],
        points: 3,
      });

      expect(questionsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ position: 3, quizId: 'quiz-1' }),
      );
      expect(result.points).toBe(3);
    });

    it('should block adding questions when attempts exist', async () => {
      attemptsRepo.count.mockResolvedValue(1);

      await expect(
        service.addQuestion('quiz-1', instructorId, {
          type: QuestionType.ESSAY,
          content: 'Essay',
          points: 5,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject out-of-range correct answer indices', async () => {
      await expect(
        service.addQuestion('quiz-1', instructorId, {
          type: QuestionType.MCQ,
          content: 'Bad',
          options: ['A', 'B'],
          correctAnswers: [2],
          points: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateQuestion', () => {
    beforeEach(() => {
      questionsRepo.findOne.mockResolvedValue(
        makeQuestion({
          id: 'q1',
          type: QuestionType.MCQ,
          options: ['A', 'B', 'C', 'D'],
        }),
      );
    });

    it('should replace the merged payload for an MCQ question', async () => {
      const result = await service.updateQuestion('q1', instructorId, {
        content: 'Edited content',
        points: 8,
      });

      expect(result.content).toBe('Edited content');
      expect(result.points).toBe(8);

      expect(questionsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.arrayContaining(['A', 'B', 'C', 'D']),
        }),
      );
    });

    it('should switch an MCQ to essay and clear options', async () => {
      const result = await service.updateQuestion('q1', instructorId, {
        type: QuestionType.ESSAY,
      });

      expect(result.type).toBe(QuestionType.ESSAY);
      expect(result.options).toEqual([]);
      expect(result.correctAnswers).toEqual([]);
    });

    it('should reject an essay question with options', async () => {
      await expect(
        service.updateQuestion('q1', instructorId, {
          type: QuestionType.MCQ,
          options: ['Only one'],
          correctAnswers: [0],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeQuestion', () => {
    beforeEach(() => {
      questionsRepo.findOne.mockResolvedValue(makeQuestion({ id: 'q1' }));
    });

    it('should remove the question and reindex the remaining ones', async () => {
      mockQueryRunner.manager.find.mockResolvedValue([
        makeQuestion({ id: 'remaining', position: 0 }),
      ]);

      await service.removeQuestion('q1', instructorId);

      expect(questionsRepo.remove).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'q1' }),
      );

      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
        Question,
        'remaining',
        { position: 0 },
      );
    });

    it('should block removing questions when attempts exist', async () => {
      attemptsRepo.count.mockResolvedValue(1);

      await expect(service.removeQuestion('q1', instructorId)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('reorderQuestions', () => {
    beforeEach(() => {
      attemptsRepo.count.mockResolvedValue(0);
    });

    it('should reorder questions and return them in the new order', async () => {
      questionsRepo.find
        .mockResolvedValueOnce([
          makeQuestion({ id: 'q1', position: 0 }),
          makeQuestion({ id: 'q2', position: 1 }),
        ])
        .mockResolvedValueOnce([
          makeQuestion({ id: 'q2', position: 0 }),
          makeQuestion({ id: 'q1', position: 1 }),
        ]);

      const result = await service.reorderQuestions('quiz-1', instructorId, {
        orderedIds: ['q2', 'q1'],
      });

      expect(result.map((q) => q.id)).toEqual(['q2', 'q1']);

      expect(questionsRepo.update).toHaveBeenNthCalledWith(
        1,
        { id: 'q2', quizId: 'quiz-1' },
        { position: 0 },
      );
    });

    it('should reject an ordered list that does not cover every question', async () => {
      questionsRepo.find.mockResolvedValue([
        makeQuestion({ id: 'q1' }),
        makeQuestion({ id: 'q2' }),
      ]);

      await expect(
        service.reorderQuestions('quiz-1', instructorId, {
          orderedIds: ['q1'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject ordering questions that do not belong to the quiz', async () => {
      questionsRepo.find.mockResolvedValue([
        makeQuestion({ id: 'q1' }),
        makeQuestion({ id: 'q2' }),
      ]);

      await expect(
        service.reorderQuestions('quiz-1', instructorId, {
          orderedIds: ['q1', 'foreign-id'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should block reordering when attempts exist', async () => {
      attemptsRepo.count.mockResolvedValue(1);

      await expect(
        service.reorderQuestions('quiz-1', instructorId, {
          orderedIds: ['q1'],
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('computePassScorePoints', () => {
    it('should ceil the percentage threshold of total points', () => {
      expect(computePassScorePoints(15, 70)).toBe(11);
      expect(computePassScorePoints(10, 70)).toBe(7);
      expect(computePassScorePoints(20, 50)).toBe(10);
    });

    it('should return 0 for a quiz with no points', () => {
      expect(computePassScorePoints(0, 70)).toBe(0);
    });
  });

  describe('DTO validation', () => {
    it('should reject quiz with passScore above 100', async () => {
      const dto = plainToInstance(CreateQuizDto, {
        title: 'Q',
        passScore: 101,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject a question with zero points', async () => {
      const dto = plainToInstance(CreateQuestionDto, {
        type: QuestionType.ESSAY,
        content: 'Essay',
        points: 0,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject a non-numeric correct answer index', async () => {
      const dto = plainToInstance(CreateQuestionDto, {
        type: QuestionType.MCQ,
        content: 'MCQ',
        options: ['A', 'B'],
        correctAnswers: ['first'],
        points: 1,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject an empty reorder list', async () => {
      const dto = plainToInstance(ReorderQuestionsDto, { orderedIds: [] });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
