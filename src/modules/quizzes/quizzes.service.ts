import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Course } from '../courses/entities/course.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import {
  CreateQuestionDto,
  CreateQuizDto,
  QuestionResponse,
  QuizResponse,
  QuizSummaryResponse,
  ReorderQuestionsDto,
  UpdateQuestionDto,
  UpdateQuizDto,
} from './dto/quiz.dto';
import { Question, QuestionType } from './entities/question.entity';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { Quiz } from './entities/quiz.entity';

export const ATTEMPTS_BLOCKED_DELETE_MESSAGE =
  'Quiz has attempts and cannot be deleted';
export const ATTEMPTS_BLOCKED_QUESTION_MESSAGE =
  'Quiz has attempts and questions cannot be modified';
export const ATTEMPTS_BLOCKED_PASS_SCORE_MESSAGE =
  'pass_score cannot be changed after attempts exist';

function computePassScorePoints(
  totalPoints: number,
  passScore: number,
): number {
  if (totalPoints <= 0) {
    return 0;
  }
  return Math.ceil((totalPoints * passScore) / 100);
}

@Injectable()
export class QuizzesService {
  constructor(
    @InjectRepository(Quiz)
    private readonly quizzesRepository: Repository<Quiz>,
    @InjectRepository(Question)
    private readonly questionsRepository: Repository<Question>,
    @InjectRepository(QuizAttempt)
    private readonly attemptsRepository: Repository<QuizAttempt>,
    @InjectRepository(Lesson)
    private readonly lessonsRepository: Repository<Lesson>,
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    courseId: string,
    lessonId: string,
    instructorId: string,
    dto: CreateQuizDto,
  ): Promise<QuizResponse> {
    await this.assertLessonOwnership(courseId, lessonId, instructorId);

    const quiz = this.quizzesRepository.create({
      lessonId,
      title: dto.title.trim(),
      description: dto.description?.trim() ?? '',
      timeLimitMinutes: dto.timeLimitMinutes ?? null,
      passScore: dto.passScore ?? 70,
    });

    const savedQuiz = await this.quizzesRepository.save(quiz);

    if (dto.questions?.length) {
      const questions = dto.questions.map((questionDto, index) => {
        const normalized = this.normalizeQuestionPayload(questionDto);
        return this.questionsRepository.create({
          quizId: savedQuiz.id,
          type: questionDto.type,
          content: questionDto.content.trim(),
          points: questionDto.points,
          options: normalized.options,
          correctAnswers: normalized.correctAnswers,
          position: index,
        });
      });

      await this.questionsRepository.save(questions);
    }

    return this.findOne(savedQuiz.id, instructorId);
  }

  async listByLesson(
    courseId: string,
    lessonId: string,
    instructorId: string,
  ): Promise<QuizSummaryResponse[]> {
    const lesson = await this.assertLessonOwnership(
      courseId,
      lessonId,
      instructorId,
    );

    const quizzes = await this.quizzesRepository.find({
      where: { lessonId },
      order: { createdAt: 'ASC' },
    });

    const quizIds = quizzes.map((quiz) => quiz.id);
    const questions = quizIds.length
      ? await this.questionsRepository.find({
          where: { quizId: In(quizIds) },
          order: { position: 'ASC', createdAt: 'ASC' },
        })
      : [];

    const questionCounts = new Map<string, number>();
    const totalPointsByQuiz = new Map<string, number>();
    for (const question of questions) {
      questionCounts.set(
        question.quizId,
        (questionCounts.get(question.quizId) ?? 0) + 1,
      );
      totalPointsByQuiz.set(
        question.quizId,
        (totalPointsByQuiz.get(question.quizId) ?? 0) + question.points,
      );
    }

    return quizzes.map((quiz) =>
      this.toQuizSummaryResponse(quiz, lesson.courseId, {
        questionCount: questionCounts.get(quiz.id) ?? 0,
        totalPoints: totalPointsByQuiz.get(quiz.id) ?? 0,
      }),
    );
  }

  async findOne(quizId: string, instructorId: string): Promise<QuizResponse> {
    const quiz = await this.getOwnedQuizEntity(quizId, instructorId);
    return this.toQuizResponse(quiz);
  }

  async update(
    quizId: string,
    instructorId: string,
    dto: UpdateQuizDto,
  ): Promise<QuizResponse> {
    const quiz = await this.getOwnedQuizEntity(quizId, instructorId);

    if (dto.title !== undefined) {
      quiz.title = dto.title.trim();
    }

    if (dto.description !== undefined) {
      quiz.description = dto.description.trim();
    }

    if (dto.timeLimitMinutes !== undefined) {
      quiz.timeLimitMinutes = dto.timeLimitMinutes;
    }

    if (dto.passScore !== undefined) {
      await this.assertNoAttempts(quizId, ATTEMPTS_BLOCKED_PASS_SCORE_MESSAGE);
      quiz.passScore = dto.passScore;
    }

    const savedQuiz = await this.quizzesRepository.save(quiz);
    return this.findOwnedWithQuestions(savedQuiz.id, instructorId);
  }

  async remove(quizId: string, instructorId: string): Promise<void> {
    const quiz = await this.getOwnedQuizEntity(quizId, instructorId);
    await this.assertNoAttempts(quizId);

    try {
      await this.quizzesRepository.remove(quiz);
    } catch (error) {
      if (
        (error as { code?: string })?.code === '23503' ||
        (error as { driverError?: { code?: string } })?.driverError?.code ===
          '23503'
      ) {
        throw new ConflictException(ATTEMPTS_BLOCKED_DELETE_MESSAGE);
      }
      throw error;
    }
  }

  async addQuestion(
    quizId: string,
    instructorId: string,
    dto: CreateQuestionDto,
  ): Promise<QuestionResponse> {
    const quiz = await this.getOwnedQuizEntity(quizId, instructorId);
    await this.assertNoAttempts(quizId, ATTEMPTS_BLOCKED_QUESTION_MESSAGE);

    const maxPosition = await this.questionsRepository.maximum('position', {
      quizId,
    });

    const normalized = this.normalizeQuestionPayload(dto);
    const question = this.questionsRepository.create({
      quizId: quiz.id,
      type: dto.type,
      content: dto.content.trim(),
      points: dto.points,
      options: normalized.options,
      correctAnswers: normalized.correctAnswers,
      position: (maxPosition ?? -1) + 1,
    });

    const savedQuestion = await this.questionsRepository.save(question);
    return this.toQuestionResponse(savedQuestion);
  }

  async updateQuestion(
    questionId: string,
    instructorId: string,
    dto: UpdateQuestionDto,
  ): Promise<QuestionResponse> {
    const question = await this.getOwnedQuestionEntity(
      questionId,
      instructorId,
    );
    await this.assertNoAttempts(
      question.quizId,
      ATTEMPTS_BLOCKED_QUESTION_MESSAGE,
    );

    const mergedType = dto.type ?? question.type;
    const payload =
      mergedType === QuestionType.ESSAY
        ? {
            type: mergedType,
            options: dto.options ?? [],
            correctAnswers: dto.correctAnswers ?? [],
          }
        : {
            type: mergedType,
            options: dto.options ?? question.options,
            correctAnswers: dto.correctAnswers ?? question.correctAnswers,
          };
    const normalized = this.normalizeQuestionPayload(payload);
    question.type = mergedType;
    question.options = normalized.options;
    question.correctAnswers = normalized.correctAnswers;

    if (dto.content !== undefined) {
      question.content = dto.content.trim();
    }
    if (dto.points !== undefined) {
      question.points = dto.points;
    }
    question.type = mergedType;
    question.options = normalized.options;
    question.correctAnswers = normalized.correctAnswers;

    const savedQuestion = await this.questionsRepository.save(question);
    return this.toQuestionResponse(savedQuestion);
  }

  async removeQuestion(
    questionId: string,
    instructorId: string,
  ): Promise<void> {
    const question = await this.getOwnedQuestionEntity(
      questionId,
      instructorId,
    );
    await this.assertNoAttempts(
      question.quizId,
      ATTEMPTS_BLOCKED_QUESTION_MESSAGE,
    );

    await this.questionsRepository.remove(question);
    await this.reindexQuestionPositions(question.quizId);
  }

  async reorderQuestions(
    quizId: string,
    instructorId: string,
    dto: ReorderQuestionsDto,
  ): Promise<QuestionResponse[]> {
    const quiz = await this.getOwnedQuizEntity(quizId, instructorId);
    await this.assertNoAttempts(quizId, ATTEMPTS_BLOCKED_QUESTION_MESSAGE);

    const existingQuestions = await this.questionsRepository.find({
      where: { quizId: quiz.id },
    });

    const existingIds = new Set(existingQuestions.map((q) => q.id));
    const dtoIds = new Set(dto.orderedIds);

    if (dto.orderedIds.length !== existingIds.size) {
      throw new BadRequestException(
        'Ordered IDs length must match the number of questions in the quiz',
      );
    }

    for (const id of dto.orderedIds) {
      if (!existingIds.has(id)) {
        throw new BadRequestException(
          `Question ${id} does not belong to this quiz`,
        );
      }
    }

    for (const id of existingIds) {
      if (!dtoIds.has(id)) {
        throw new BadRequestException(
          `Question ${id} is missing from the ordered list`,
        );
      }
    }

    const updates = dto.orderedIds.map((id, index) =>
      this.questionsRepository.update(
        { id, quizId: quiz.id },
        { position: index },
      ),
    );

    await Promise.all(updates);

    const reordered = await this.questionsRepository.find({
      where: { quizId: quiz.id },
      order: { position: 'ASC' },
    });

    return reordered.map((q) => this.toQuestionResponse(q));
  }

  async assertLessonOwnership(
    courseId: string,
    lessonId: string,
    instructorId: string,
  ): Promise<Lesson> {
    const lesson = await this.lessonsRepository.findOne({
      where: { id: lessonId },
      relations: { course: true },
    });

    if (!lesson) {
      throw new NotFoundException('Lesson not found');
    }

    if (lesson.courseId !== courseId) {
      throw new BadRequestException('Lesson does not belong to this course');
    }

    if (lesson.course.instructorId !== instructorId) {
      throw new ForbiddenException('You do not own this course');
    }

    return lesson;
  }

  private async getOwnedQuizEntity(
    quizId: string,
    instructorId: string,
  ): Promise<Quiz> {
    const quiz = await this.quizzesRepository.findOne({
      where: { id: quizId },
      relations: {
        lesson: { course: true },
        questions: true,
      },
    });

    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }

    if (quiz.lesson.course.instructorId !== instructorId) {
      throw new ForbiddenException('You do not own this quiz');
    }

    return quiz;
  }

  private async getOwnedQuestionEntity(
    questionId: string,
    instructorId: string,
  ): Promise<Question> {
    const question = await this.questionsRepository.findOne({
      where: { id: questionId },
      relations: { quiz: { lesson: { course: true } } },
    });

    if (!question) {
      throw new NotFoundException('Question not found');
    }

    if (question.quiz.lesson.course.instructorId !== instructorId) {
      throw new ForbiddenException('You do not own this question');
    }

    return question;
  }

  private async findOwnedWithQuestions(
    quizId: string,
    instructorId: string,
  ): Promise<QuizResponse> {
    return this.findOne(quizId, instructorId);
  }

  private async assertNoAttempts(
    quizId: string,
    message: string = ATTEMPTS_BLOCKED_DELETE_MESSAGE,
  ): Promise<void> {
    const attemptCount = await this.attemptsRepository.count({
      where: { quizId },
    });

    if (attemptCount > 0) {
      throw new ConflictException(message);
    }
  }

  private async reindexQuestionPositions(quizId: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const questions = await queryRunner.manager.find(Question, {
        where: { quizId },
        order: { position: 'ASC', createdAt: 'ASC' },
      });

      for (let index = 0; index < questions.length; index++) {
        await queryRunner.manager.update(Question, questions[index].id, {
          position: index,
        });
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private normalizeQuestionPayload(payload: {
    type: QuestionType;
    options?: string[];
    correctAnswers?: number[];
  }): { options: string[]; correctAnswers: number[] } {
    if (payload.type === QuestionType.MCQ) {
      const options = (payload.options ?? []).map((option) => option.trim());
      if (options.length < 2) {
        throw new BadRequestException(
          'MCQ question requires at least 2 options',
        );
      }

      const correctAnswers = payload.correctAnswers ?? [];
      if (correctAnswers.length === 0) {
        throw new BadRequestException(
          'MCQ question requires at least one correct answer',
        );
      }

      const uniqueCorrect = new Set<number>();
      for (const index of correctAnswers) {
        if (index >= options.length) {
          throw new BadRequestException(
            'Correct answer index is out of options range',
          );
        }
        uniqueCorrect.add(index);
      }

      if (uniqueCorrect.size !== correctAnswers.length) {
        throw new BadRequestException('Correct answer indices must be unique');
      }

      return { options, correctAnswers: [...uniqueCorrect] };
    }

    if ((payload.options ?? []).length > 0) {
      throw new BadRequestException('Essay questions cannot have options');
    }

    if ((payload.correctAnswers ?? []).length > 0) {
      throw new BadRequestException(
        'Essay questions cannot have correct answers',
      );
    }

    return { options: [], correctAnswers: [] };
  }

  private toQuestionResponse(question: Question): QuestionResponse {
    return {
      id: question.id,
      quizId: question.quizId,
      type: question.type,
      content: question.content,
      options: question.options ?? [],
      correctAnswers: question.correctAnswers ?? [],
      points: question.points,
      position: question.position,
      createdAt: question.createdAt,
      updatedAt: question.updatedAt,
    };
  }

  private toQuizResponse(quiz: Quiz): QuizResponse {
    const orderedQuestions = [...quiz.questions].sort(
      (a, b) =>
        a.position - b.position ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const totalPoints = orderedQuestions.reduce(
      (sum, question) => sum + question.points,
      0,
    );

    return {
      id: quiz.id,
      lessonId: quiz.lessonId,
      courseId: quiz.lesson.courseId,
      title: quiz.title,
      description: quiz.description,
      timeLimitMinutes: quiz.timeLimitMinutes,
      passScore: quiz.passScore,
      totalPoints,
      passScorePoints: computePassScorePoints(totalPoints, quiz.passScore),
      questions: orderedQuestions.map((q) => this.toQuestionResponse(q)),
      createdAt: quiz.createdAt,
      updatedAt: quiz.updatedAt,
    };
  }

  private toQuizSummaryResponse(
    quiz: Quiz,
    courseId: string,
    stats: { questionCount: number; totalPoints: number },
  ): QuizSummaryResponse {
    return {
      id: quiz.id,
      lessonId: quiz.lessonId,
      courseId,
      title: quiz.title,
      description: quiz.description,
      timeLimitMinutes: quiz.timeLimitMinutes,
      passScore: quiz.passScore,
      totalPoints: stats.totalPoints,
      passScorePoints: computePassScorePoints(
        stats.totalPoints,
        quiz.passScore,
      ),
      questionCount: stats.questionCount,
      createdAt: quiz.createdAt,
      updatedAt: quiz.updatedAt,
    };
  }
}

export { computePassScorePoints };
