import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Workbook, Worksheet } from 'exceljs';
import { DataSource, Repository } from 'typeorm';
import { Course } from '../courses/entities/course.entity';
import { CourseProgressService } from '../learning/course-progress.service';
import { Lesson } from '../lessons/entities/lesson.entity';
import {
  CreateQuestionDto,
  CreateQuizDto,
  QuestionResponse,
  QuizImportResponse,
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
export const LESSON_ALREADY_HAS_QUIZ_MESSAGE = 'Lesson already has a quiz';

interface ImportedQuizMetadata {
  title: string;
  description: string;
  timeLimitMinutes: number | null;
  passScore: number | null;
}

interface ImportedQuestion {
  sourceOrder: number;
  type: QuestionType;
  content: string;
  options: string[];
  correctAnswers: number[];
  points: number;
}

function computePassScorePoints(
  totalPoints: number,
  passScore: number,
): number {
  if (totalPoints <= 0) {
    return 0;
  }
  return Math.ceil((totalPoints * passScore) / 100);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
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
    private readonly courseProgressService: CourseProgressService,
  ) {}

  async create(
    courseId: string,
    lessonId: string,
    instructorId: string,
    dto: CreateQuizDto,
  ): Promise<QuizResponse> {
    const lesson = await this.assertLessonOwnership(
      courseId,
      lessonId,
      instructorId,
    );

    const existingQuiz = await this.quizzesRepository.findOne({
      where: { lessonId },
      select: { id: true },
    });

    if (existingQuiz) {
      throw new ConflictException(LESSON_ALREADY_HAS_QUIZ_MESSAGE);
    }

    const quiz = this.quizzesRepository.create({
      lessonId,
      title: dto.title.trim(),
      description: dto.description?.trim() ?? '',
      timeLimitMinutes: dto.timeLimitMinutes ?? null,
      passScore: dto.passScore ?? 70,
    });

    let savedQuiz: Quiz;
    try {
      savedQuiz = await this.quizzesRepository.save(quiz);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(LESSON_ALREADY_HAS_QUIZ_MESSAGE);
      }
      throw error;
    }

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

    await this.refreshProgressForQuizRuleChange(
      Object.assign(savedQuiz, { lesson }),
    );

    return this.findOne(savedQuiz.id, instructorId);
  }

  async findByLesson(
    courseId: string,
    lessonId: string,
    instructorId: string,
  ): Promise<QuizSummaryResponse | null> {
    const lesson = await this.assertLessonOwnership(
      courseId,
      lessonId,
      instructorId,
    );

    const quiz = await this.quizzesRepository.findOne({
      where: { lessonId },
      order: { createdAt: 'ASC' },
    });

    if (!quiz) {
      return null;
    }

    const questions = await this.questionsRepository.find({
      where: { quizId: quiz.id },
      order: { position: 'ASC', createdAt: 'ASC' },
    });

    const totalPoints = questions.reduce(
      (sum, question) => sum + question.points,
      0,
    );

    return this.toQuizSummaryResponse(quiz, lesson.courseId, {
      questionCount: questions.length,
      totalPoints,
    });
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

    const nextPassScore = dto.passScore;
    const passScoreChanged = nextPassScore !== undefined;

    if (passScoreChanged) {
      await this.assertNoAttempts(quizId, ATTEMPTS_BLOCKED_PASS_SCORE_MESSAGE);
      quiz.passScore = nextPassScore;
    }

    const savedQuiz = await this.quizzesRepository.save(quiz);
    if (passScoreChanged) {
      await this.refreshProgressForQuizRuleChange(savedQuiz);
    }
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

    await this.refreshProgressForQuizRuleChange(quiz);
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
    await this.refreshProgressForQuizRuleChange(quiz);
    return this.toQuestionResponse(savedQuestion);
  }

  async importExcel(
    courseId: string,
    lessonId: string,
    instructorId: string,
    fileBuffer: Buffer,
  ): Promise<QuizImportResponse> {
    const lesson = await this.assertLessonOwnership(
      courseId,
      lessonId,
      instructorId,
    );
    const imported = await this.parseExcelImport(fileBuffer);

    const result = await this.dataSource.transaction(async (manager) => {
      let quiz = await manager.findOne(Quiz, {
        where: { lessonId },
      });
      const createdQuiz = !quiz;

      if (!quiz) {
        const metadata = this.requireQuizMetadata(imported.quiz);
        quiz = manager.create(Quiz, {
          lessonId,
          title: metadata.title,
          description: metadata.description,
          timeLimitMinutes: metadata.timeLimitMinutes,
          passScore: metadata.passScore ?? 70,
        });

        try {
          quiz = await manager.save(quiz);
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ConflictException(LESSON_ALREADY_HAS_QUIZ_MESSAGE);
          }
          throw error;
        }
      } else {
        const attemptCount = await manager.count(QuizAttempt, {
          where: { quizId: quiz.id },
        });
        if (attemptCount > 0) {
          throw new ConflictException(ATTEMPTS_BLOCKED_QUESTION_MESSAGE);
        }
      }

      const existingQuestions = await manager.find(Question, {
        where: { quizId: quiz.id },
      });
      const firstPosition =
        existingQuestions.reduce(
          (max, question) => Math.max(max, question.position),
          -1,
        ) + 1;
      const questions = imported.questions.map((question, index) =>
        manager.create(Question, {
          quizId: quiz.id,
          type: question.type,
          content: question.content,
          options: question.options,
          correctAnswers: question.correctAnswers,
          points: question.points,
          position: firstPosition + index,
        }),
      );
      await manager.save(questions);

      const totalPoints =
        existingQuestions.reduce((sum, question) => sum + question.points, 0) +
        imported.questions.reduce((sum, question) => sum + question.points, 0);

      return {
        quiz,
        createdQuiz,
        questionCount: existingQuestions.length + questions.length,
        totalPoints,
      };
    });

    await this.refreshProgressForQuizRuleChange(
      Object.assign(result.quiz, { lesson }),
    );

    return {
      quizId: result.quiz.id,
      title: result.quiz.title,
      questionCount: result.questionCount,
      totalPoints: result.totalPoints,
      passScore: result.quiz.passScore,
      passScorePoints: computePassScorePoints(
        result.totalPoints,
        result.quiz.passScore,
      ),
      createdQuiz: result.createdQuiz,
    };
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
    await this.refreshProgressForQuizRuleChange(question.quiz);
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
    await this.refreshProgressForQuizRuleChange(question.quiz);
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

  private requireQuizMetadata(
    metadata: ImportedQuizMetadata | null,
  ): ImportedQuizMetadata {
    if (!metadata || !metadata.title) {
      throw new BadRequestException({
        message: 'Excel validation failed',
        details: ['Quiz!2 title is required when the lesson has no quiz'],
      });
    }

    return metadata;
  }

  private async parseExcelImport(buffer: Buffer): Promise<{
    quiz: ImportedQuizMetadata | null;
    questions: ImportedQuestion[];
  }> {
    const workbook = new Workbook();
    try {
      await workbook.xlsx.load(buffer as never);
    } catch {
      throw this.invalidExcel(['File must be a valid .xlsx workbook']);
    }

    const details: string[] = [];
    const questionsSheet = workbook.getWorksheet('Questions');
    if (!questionsSheet) {
      throw this.invalidExcel(['Missing required sheet: Questions']);
    }

    const quizSheet = workbook.getWorksheet('Quiz');
    const quiz = quizSheet
      ? this.parseQuizExcelSheet(quizSheet, details)
      : null;
    const questions = this.parseQuestionExcelSheet(questionsSheet, details);
    if (details.length > 0) throw this.invalidExcel(details);
    return { quiz, questions };
  }

  private parseQuizExcelSheet(
    sheet: Worksheet,
    details: string[],
  ): ImportedQuizMetadata {
    const columns = this.excelColumns(
      sheet,
      ['title', 'description', 'time_limit_minutes', 'pass_score'],
      details,
    );
    const row = sheet.getRow(2);
    const title = this.excelValue(row, columns.title).trim();
    const description = this.excelValue(row, columns.description).trim();
    if (title.length > 200)
      details.push('Quiz!2 title must be between 1 and 200 characters');
    if (description.length > 5000)
      details.push('Quiz!2 description must not exceed 5000 characters');
    return {
      title,
      description,
      timeLimitMinutes: this.excelInteger(
        this.excelValue(row, columns.time_limit_minutes),
        'Quiz!2 time_limit_minutes',
        0,
        1440,
        details,
      ),
      passScore: this.excelInteger(
        this.excelValue(row, columns.pass_score),
        'Quiz!2 pass_score',
        0,
        100,
        details,
      ),
    };
  }

  private parseQuestionExcelSheet(
    sheet: Worksheet,
    details: string[],
  ): ImportedQuestion[] {
    const columns = this.excelColumns(
      sheet,
      [
        'order',
        'type',
        'question',
        'option_a',
        'option_b',
        'correct_answers',
        'points',
      ],
      details,
    );
    const questions: ImportedQuestion[] = [];
    const usedOrders = new Set<number>();
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      if (
        Object.values(columns).every((column) => !this.excelValue(row, column))
      )
        continue;
      const prefix = `Questions!${rowNumber}`;
      const sourceOrder = this.requiredExcelInteger(
        this.excelValue(row, columns.order),
        `${prefix} order`,
        1,
        Number.MAX_SAFE_INTEGER,
        details,
      );
      if (sourceOrder !== null) {
        if (usedOrders.has(sourceOrder))
          details.push(`${prefix} order must be unique in this file`);
        usedOrders.add(sourceOrder);
      }
      const typeValue = this.excelValue(row, columns.type).trim().toUpperCase();
      const type =
        typeValue === 'MCQ'
          ? QuestionType.MCQ
          : typeValue === 'ESSAY'
            ? QuestionType.ESSAY
            : null;
      if (!type) details.push(`${prefix} type must be MCQ or ESSAY`);
      const content = this.excelValue(row, columns.question).trim();
      if (!content || content.length > 4000)
        details.push(
          `${prefix} question must be between 1 and 4000 characters`,
        );
      const points = this.requiredExcelInteger(
        this.excelValue(row, columns.points),
        `${prefix} points`,
        1,
        1000,
        details,
      );
      const options = [...'abcdefghij'].flatMap((letter) => {
        const value = this.excelValue(row, columns[`option_${letter}`]).trim();
        return value ? [value] : [];
      });
      const answers = this.excelAnswers(
        this.excelValue(row, columns.correct_answers),
        `${prefix} correct_answers`,
        details,
      );
      if (type === QuestionType.MCQ) {
        if (options.length < 2)
          details.push(`${prefix} MCQ requires at least 2 options`);
        if (answers.length === 0)
          details.push(`${prefix} MCQ requires at least one correct answer`);
        if (answers.some((answer) => answer >= options.length))
          details.push(
            `${prefix} correct_answers must reference a filled option`,
          );
      }
      if (type === QuestionType.ESSAY) {
        if (options.length > 0)
          details.push(`${prefix} essay cannot have options`);
        if (answers.length > 0)
          details.push(`${prefix} essay cannot have correct_answers`);
      }
      if (sourceOrder !== null && type && content && points !== null) {
        questions.push({
          sourceOrder,
          type,
          content,
          options: type === QuestionType.ESSAY ? [] : options,
          correctAnswers: type === QuestionType.ESSAY ? [] : answers,
          points,
        });
      }
    }
    if (!questions.length && !details.length)
      details.push('Questions!2 At least one question is required');
    return questions.sort((a, b) => a.sourceOrder - b.sourceOrder);
  }

  private excelColumns(
    sheet: Worksheet,
    expected: string[],
    details: string[],
  ): Record<string, number> {
    const columns: Record<string, number> = {};
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, index) => {
      const header = cell.text
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
      if (header) columns[header] = index;
    });
    expected.forEach((header) => {
      if (!columns[header])
        details.push(`${sheet.name}!1 Missing required column: ${header}`);
    });
    return columns;
  }

  private excelValue(
    row: ReturnType<Worksheet['getRow']>,
    column?: number,
  ): string {
    return column ? row.getCell(column).text : '';
  }

  private requiredExcelInteger(
    value: string,
    label: string,
    min: number,
    max: number,
    details: string[],
  ): number | null {
    if (!value.trim()) {
      details.push(`${label} is required`);
      return null;
    }
    return this.excelInteger(value, label, min, max, details);
  }

  private excelInteger(
    value: string,
    label: string,
    min: number,
    max: number,
    details: string[],
  ): number | null {
    if (!value.trim()) return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
      details.push(`${label} must be an integer between ${min} and ${max}`);
      return null;
    }
    return number;
  }

  private excelAnswers(
    value: string,
    label: string,
    details: string[],
  ): number[] {
    const unique = new Set<number>();
    for (const answer of value
      .split(',')
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean)) {
      const index = 'ABCDEFGHIJ'.indexOf(answer);
      if (index < 0 || answer.length !== 1)
        details.push(
          `${label} must contain comma-separated option letters A-J`,
        );
      else if (unique.has(index))
        details.push(`${label} cannot repeat an answer`);
      else unique.add(index);
    }
    return [...unique];
  }

  private invalidExcel(details: string[]): BadRequestException {
    return new BadRequestException({
      message: 'Excel validation failed',
      details,
    });
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

  private async refreshProgressForQuizRuleChange(quiz: Quiz): Promise<void> {
    await this.courseProgressService.refreshLessonCompletionsForLesson(
      quiz.lessonId,
    );
    await this.courseProgressService.recomputeCourseEnrollmentsProgress(
      quiz.lesson.courseId,
    );
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
