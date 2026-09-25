import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  FindOptionsWhere,
  In,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { Course } from '../courses/entities/course.entity';
import { LearningProgressService } from '../learning/learning-progress.service';
import { NotificationsQueueService } from '../notifications/notifications-queue.service';
import { User } from '../users/entities/user.entity';
import {
  EssayGradingQuestionResponse,
  EssayGradingSubmissionListResponse,
  EssayGradingStatusFilter,
  EssayGradingSubmissionResponse,
  GradeEssayAnswerDto,
  ListEssayGradingSubmissionsQueryDto,
} from './dto/essay-grading.dto';
import {
  QuizAttemptQuestionResult,
  QuizAttemptResultResponse,
  QuizAttemptStatus,
} from './dto/quiz-attempt.dto';
import { Question, QuestionType } from './entities/question.entity';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { Quiz } from './entities/quiz.entity';

interface InstructorQuizContext {
  course: Course;
  quiz: Quiz;
  questions: Question[];
}

@Injectable()
export class EssayGradingService {
  private readonly logger = new Logger(EssayGradingService.name);

  constructor(
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    @InjectRepository(Quiz)
    private readonly quizzesRepository: Repository<Quiz>,
    @InjectRepository(QuizAttempt)
    private readonly attemptsRepository: Repository<QuizAttempt>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly learningProgressService: LearningProgressService,
    private readonly dataSource: DataSource,
    private readonly notificationsQueueService: NotificationsQueueService,
  ) {}

  async listSubmissions(
    instructorId: string,
    query: ListEssayGradingSubmissionsQueryDto,
  ): Promise<EssayGradingSubmissionListResponse> {
    if (query.lessonId && !query.courseId) {
      throw new BadRequestException(
        'courseId is required when lessonId is set',
      );
    }

    if (query.courseId) {
      const course = await this.coursesRepository.findOne({
        where: { id: query.courseId },
      });
      if (!course) {
        throw new NotFoundException('Course not found');
      }
      if (course.instructorId !== instructorId) {
        throw new ForbiddenException('You do not own this course');
      }
    }

    const quizWhere: FindOptionsWhere<Quiz> = {
      lesson: {
        ...(query.lessonId ? { id: query.lessonId } : {}),
        course: {
          instructorId,
          ...(query.courseId ? { id: query.courseId } : {}),
        },
      },
    };
    const quizzes = await this.quizzesRepository.find({
      where: quizWhere,
      relations: { lesson: { course: true }, questions: true },
    });
    const quizById = new Map(quizzes.map((quiz) => [quiz.id, quiz]));
    const quizIds = quizzes.map((quiz) => quiz.id);
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    if (quizIds.length === 0) {
      return {
        items: [],
        total: 0,
        page,
        limit,
        totalPages: 1,
      };
    }

    const attempts = await this.attemptsRepository.find({
      where: { quizId: In(quizIds), submittedAt: Not(IsNull()) },
      order: { submittedAt: 'DESC', createdAt: 'DESC' },
    });
    if (attempts.length === 0) {
      return {
        items: [],
        total: 0,
        page,
        limit,
        totalPages: 1,
      };
    }

    const learners = await this.usersRepository.find({
      where: {
        id: In([...new Set(attempts.map((attempt) => attempt.learnerId))]),
      },
    });
    const learnerById = new Map(
      learners.map((learner) => [learner.id, learner]),
    );
    const filter = query.status ?? EssayGradingStatusFilter.PENDING;
    const filtered = attempts
      .map((attempt) => {
        const quiz = quizById.get(attempt.quizId);
        if (!quiz) {
          return null;
        }
        return this.toSubmissionResponse(
          attempt,
          quiz,
          quiz.questions ?? [],
          learnerById,
        );
      })
      .filter((submission): submission is EssayGradingSubmissionResponse => {
        if (!submission || submission.essays.length === 0) {
          return false;
        }
        if (filter === EssayGradingStatusFilter.ALL) {
          return true;
        }
        const hasPending = submission.essays.some(
          (essay) => essay.status === 'pending_grading',
        );
        return filter === EssayGradingStatusFilter.PENDING
          ? hasPending
          : !hasPending;
      });

    const total = filtered.length;
    const items = filtered.slice((page - 1) * limit, page * limit);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async gradeEssay(
    instructorId: string,
    courseId: string,
    quizId: string,
    attemptId: string,
    questionId: string,
    dto: GradeEssayAnswerDto,
  ): Promise<QuizAttemptResultResponse> {
    const { quiz, questions } = await this.loadInstructorQuizContext(
      instructorId,
      courseId,
      quizId,
    );
    const question = questions.find((item) => item.id === questionId);
    if (!question || question.type !== QuestionType.ESSAY) {
      throw new BadRequestException('Question is not an essay question');
    }
    if (dto.points > question.points) {
      throw new BadRequestException(
        'Essay points exceed the question max score',
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let committed = false;

    try {
      const attempt = await queryRunner.manager.findOne(QuizAttempt, {
        where: { id: attemptId, quizId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!attempt) {
        throw new NotFoundException('Attempt not found');
      }
      if (!attempt.submittedAt) {
        throw new ConflictException('Quiz attempt has not been submitted');
      }

      const results = this.getQuestionResults(attempt);
      const resultIndex = results.findIndex(
        (result) => result.questionId === questionId,
      );
      if (resultIndex === -1) {
        throw new ConflictException('Essay result not found on attempt');
      }

      const previousPassed = attempt.passed;
      const maxScore = results[resultIndex].maxScore ?? question.points;
      const gradedResult: QuizAttemptQuestionResult = {
        ...results[resultIndex],
        type: QuestionType.ESSAY,
        text: results[resultIndex].text ?? '',
        score: dto.points,
        maxScore,
        feedback: dto.feedback ?? '',
        gradedAt: new Date().toISOString(),
        gradedBy: instructorId,
        isCorrect: dto.points === maxScore,
        status:
          dto.points === maxScore
            ? 'correct'
            : dto.points > 0
              ? 'partial'
              : 'wrong',
      };
      results[resultIndex] = gradedResult;

      this.applyRecomputedAttempt(attempt, results);
      const saved = await queryRunner.manager.save(QuizAttempt, attempt);
      await queryRunner.commitTransaction();
      committed = true;

      if (previousPassed !== saved.passed) {
        await this.learningProgressService.recomputeLessonAndEnrollmentProgress(
          saved.learnerId,
          courseId,
          quiz.lessonId,
        );
      }

      this.notifyEssayGraded({
        attemptId: saved.id,
        quizId,
        courseId,
        lessonId: quiz.lessonId,
        learnerId: saved.learnerId,
        instructorId,
        pendingEssayCount: saved.pendingEssayCount,
        passed: saved.passed,
        status: saved.status,
      });

      return this.toAttemptResult(saved);
    } catch (error) {
      if (!committed) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async loadInstructorQuizContext(
    instructorId: string,
    courseId: string,
    quizId: string,
  ): Promise<InstructorQuizContext> {
    const course = await this.coursesRepository.findOne({
      where: { id: courseId },
    });
    if (!course) {
      throw new NotFoundException('Course not found');
    }
    if (course.instructorId !== instructorId) {
      throw new ForbiddenException('You do not own this course');
    }

    const quiz = await this.quizzesRepository.findOne({
      where: { id: quizId },
      relations: { lesson: true, questions: true },
    });
    if (!quiz || quiz.lesson.courseId !== courseId) {
      throw new NotFoundException('Quiz not found');
    }

    return { course, quiz, questions: quiz.questions ?? [] };
  }

  private toSubmissionResponse(
    attempt: QuizAttempt,
    quiz: Quiz,
    questions: Question[],
    learnerById: Map<string, User>,
  ): EssayGradingSubmissionResponse | null {
    const essays = this.toEssayResponses(attempt, questions);
    if (essays.length === 0) {
      return null;
    }
    const learner = learnerById.get(attempt.learnerId);

    return {
      attemptId: attempt.id,
      courseId: quiz.lesson.courseId,
      courseTitle: quiz.lesson.course.title,
      lessonId: quiz.lessonId,
      lessonTitle: quiz.lesson.title,
      quizId: quiz.id,
      quizTitle: quiz.title,
      learner: {
        id: attempt.learnerId,
        name: learner?.name ?? '',
        email: learner?.email ?? '',
      },
      submittedAt: attempt.submittedAt,
      totalScore: Number(attempt.score),
      totalPoints: Number(attempt.totalPoints),
      passScore: attempt.passScore,
      passScorePoints: attempt.passScorePoints,
      passed: attempt.passed,
      status: attempt.status,
      pendingEssayCount: attempt.pendingEssayCount,
      essays,
    };
  }

  private toEssayResponses(
    attempt: QuizAttempt,
    questions: Question[],
  ): EssayGradingQuestionResponse[] {
    const questionById = new Map(
      questions.map((question) => [question.id, question]),
    );
    return this.getQuestionResults(attempt)
      .filter((result) => {
        const question = questionById.get(result.questionId);
        return (
          result.type === QuestionType.ESSAY ||
          question?.type === QuestionType.ESSAY
        );
      })
      .map((result) => ({
        questionId: result.questionId,
        content: questionById.get(result.questionId)?.content ?? '',
        text: result.text ?? '',
        score: result.score,
        maxScore: result.maxScore,
        status: result.status,
        feedback: result.feedback,
        gradedAt: result.gradedAt,
        gradedBy: result.gradedBy,
      }));
  }

  private getQuestionResults(
    attempt: QuizAttempt,
  ): QuizAttemptQuestionResult[] {
    if (!Array.isArray(attempt.gradingResult)) {
      return [];
    }

    return [...(attempt.gradingResult as QuizAttemptQuestionResult[])];
  }

  private applyRecomputedAttempt(
    attempt: QuizAttempt,
    results: QuizAttemptQuestionResult[],
  ): void {
    const totalScore = Number(
      results.reduce((sum, result) => sum + result.score, 0).toFixed(2),
    );
    const pendingEssayCount = results.filter(
      (result) =>
        result.type === QuestionType.ESSAY &&
        result.status === 'pending_grading',
    ).length;
    const passed =
      totalScore >= attempt.passScorePoints && pendingEssayCount === 0;

    attempt.gradingResult = results;
    attempt.score = totalScore.toFixed(2);
    attempt.pendingEssayCount = pendingEssayCount;
    attempt.passed = passed;
    attempt.status = passed
      ? QuizAttemptStatus.PASSED
      : QuizAttemptStatus.NOT_PASSED;
    attempt.correctCount = results.filter(
      (result) => result.status === 'correct',
    ).length;
    attempt.wrongCount = results.filter(
      (result) => result.status === 'wrong',
    ).length;
  }

  private toAttemptResult(attempt: QuizAttempt): QuizAttemptResultResponse {
    return {
      attemptId: attempt.id,
      quizId: attempt.quizId,
      startedAt: attempt.startedAt ?? attempt.createdAt,
      submittedAt: attempt.submittedAt,
      timeLimitMinutes: attempt.timeLimitMinutes,
      isLate: attempt.isLate,
      lateSeconds: attempt.lateSeconds,
      totalScore: Number(attempt.score),
      totalPoints: Number(attempt.totalPoints),
      passScore: attempt.passScore,
      passScorePoints: attempt.passScorePoints,
      passed: attempt.passed,
      status: attempt.status,
      correctCount: attempt.correctCount,
      wrongCount: attempt.wrongCount,
      pendingEssayCount: attempt.pendingEssayCount,
      questions: Array.isArray(attempt.gradingResult)
        ? (attempt.gradingResult as QuizAttemptQuestionResult[])
        : [],
    };
  }

  private notifyEssayGraded(input: {
    attemptId: string;
    quizId: string;
    courseId: string;
    lessonId: string;
    learnerId: string;
    instructorId: string;
    pendingEssayCount: number;
    passed: boolean;
    status: QuizAttemptStatus;
  }): void {
    if (input.pendingEssayCount !== 0) {
      return;
    }

    try {
      this.notificationsQueueService.enqueueCreateNotification({
        kind: 'direct',
        targetUserId: input.learnerId,
        title: 'Bài tự luận đã được chấm',
        message: 'Giảng viên đã hoàn tất chấm bài tự luận của bạn.',
        actionUrl: `/learner/courses/${input.courseId}/learn?lessonId=${input.lessonId}`,
        metadata: {
          attemptId: input.attemptId,
          quizId: input.quizId,
          courseId: input.courseId,
          lessonId: input.lessonId,
          learnerId: input.learnerId,
          instructorId: input.instructorId,
          pendingEssayCount: input.pendingEssayCount,
          passed: input.passed,
          status: input.status,
        },
        sentAt: new Date().toISOString(),
        triggerKey: `essay-graded:${input.attemptId}`,
        triggerDate: this.getNotificationTriggerDate(),
      });
    } catch (error) {
      this.logger.error(
        'Could not enqueue essay graded notification',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private getNotificationTriggerDate(date = new Date()): string {
    return date.toISOString().slice(0, 10);
  }
}
