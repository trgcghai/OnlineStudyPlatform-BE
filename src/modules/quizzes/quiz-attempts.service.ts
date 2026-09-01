import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { LearningProgressService } from '../learning/learning-progress.service';
import { Lesson } from '../lessons/entities/lesson.entity';
import { LearningAccessService } from '../lessons/learning-access.service';
import {
  LearnerQuizLoadResponse,
  LearnerQuizResponse,
  QuizAttemptQuestionResult,
  QuizAttemptResultResponse,
  QuizAttemptStartResponse,
  QuizAttemptStatus,
  SubmitQuizAnswerDto,
  SubmitQuizAttemptDto,
} from './dto/quiz-attempt.dto';
import { Question, QuestionType } from './entities/question.entity';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { Quiz } from './entities/quiz.entity';
import { computePassScorePoints } from './quizzes.service';

const LEARNING_ENROLLMENT_REQUIRED_MESSAGE =
  'Bạn cần đăng ký khóa học để học nội dung này';
const ATTEMPT_EXPIRY_BUFFER_HOURS = 48;
const MILLISECONDS_PER_MINUTE = 60 * 1000;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;

type LearningProgressWithQuizRecompute = LearningProgressService & {
  recomputeLessonAndEnrollmentProgress?: (
    learnerId: string,
    courseId: string,
    lessonId: string,
  ) => Promise<void>;
};

interface QuizContext {
  course: Course;
  enrollment: Enrollment;
  lesson: Lesson;
  quiz: Quiz | null;
}

interface GradingOutput {
  answers: SubmitQuizAnswerDto[];
  questions: QuizAttemptQuestionResult[];
  totalScore: number;
  totalPoints: number;
  passScorePoints: number;
  passed: boolean;
  status: QuizAttemptStatus.PASSED | QuizAttemptStatus.NOT_PASSED;
  correctCount: number;
  wrongCount: number;
  pendingEssayCount: number;
  isLate: boolean;
  lateSeconds: number;
}

@Injectable()
export class QuizAttemptsService {
  constructor(
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    @InjectRepository(Lesson)
    private readonly lessonsRepository: Repository<Lesson>,
    @InjectRepository(Enrollment)
    private readonly enrollmentsRepository: Repository<Enrollment>,
    @InjectRepository(Quiz)
    private readonly quizzesRepository: Repository<Quiz>,
    @InjectRepository(QuizAttempt)
    private readonly attemptsRepository: Repository<QuizAttempt>,
    @InjectRepository(LearningAnalyticsEvent)
    private readonly analyticsEventsRepository: Repository<LearningAnalyticsEvent>,
    private readonly learningAccessService: LearningAccessService,
    private readonly learningProgressService: LearningProgressService,
    private readonly dataSource: DataSource,
  ) {}

  async loadLearnerQuiz(
    learnerId: string,
    courseId: string,
    lessonId: string,
  ): Promise<LearnerQuizLoadResponse> {
    const { quiz } = await this.loadAccessibleQuizContext(
      learnerId,
      courseId,
      lessonId,
    );

    return { quiz: quiz ? this.toLearnerQuizResponse(quiz) : null };
  }

  async startAttempt(
    learnerId: string,
    courseId: string,
    lessonId: string,
    quizId: string,
  ): Promise<QuizAttemptStartResponse> {
    const { quiz } = await this.loadAccessibleQuizContext(
      learnerId,
      courseId,
      lessonId,
      quizId,
    );

    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }

    const learnerQuiz = this.toLearnerQuizResponse(quiz);
    const startedAt = new Date();
    const expiresAt = this.computeExpiresAt(startedAt, quiz.timeLimitMinutes);
    const attempt = await this.attemptsRepository.save(
      this.attemptsRepository.create({
        learnerId,
        quizId,
        status: QuizAttemptStatus.IN_PROGRESS,
        startedAt,
        submittedAt: null,
        answers: null,
        gradingResult: null,
        score: '0.00',
        totalPoints: learnerQuiz.totalPoints.toFixed(2),
        passScore: quiz.passScore,
        passScorePoints: learnerQuiz.passScorePoints,
        passed: false,
        correctCount: 0,
        wrongCount: 0,
        pendingEssayCount: 0,
        timeLimitMinutes: quiz.timeLimitMinutes,
        expiresAt,
        isLate: false,
        lateSeconds: 0,
      }),
    );

    return {
      attemptId: attempt.id,
      quiz: learnerQuiz,
      startedAt,
      timeLimitMinutes: attempt.timeLimitMinutes,
    };
  }

  async submitAttempt(
    learnerId: string,
    courseId: string,
    lessonId: string,
    quizId: string,
    attemptId: string,
    dto: SubmitQuizAttemptDto,
  ): Promise<QuizAttemptResultResponse> {
    const { quiz } = await this.loadAccessibleQuizContext(
      learnerId,
      courseId,
      lessonId,
      quizId,
    );

    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const attempt = await queryRunner.manager.findOne(QuizAttempt, {
        where: { id: attemptId, quizId, learnerId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!attempt) {
        throw new NotFoundException('Attempt not found');
      }

      if (attempt.learnerId !== learnerId || attempt.quizId !== quizId) {
        throw new NotFoundException('Attempt not found');
      }

      if (
        attempt.submittedAt ||
        attempt.status !== QuizAttemptStatus.IN_PROGRESS
      ) {
        throw new ConflictException('Quiz attempt has already been submitted');
      }

      const submittedAt = new Date();
      const expiresAt = this.getAttemptExpiresAt(attempt, submittedAt);
      if (submittedAt.getTime() > expiresAt.getTime()) {
        throw new ConflictException('Quiz attempt has expired');
      }

      const grading = this.gradeQuiz(
        quiz,
        dto.answers,
        submittedAt,
        attempt.startedAt ?? submittedAt,
        attempt.timeLimitMinutes,
      );

      attempt.answers = grading.answers;
      attempt.gradingResult = grading.questions;
      attempt.score = grading.totalScore.toFixed(2);
      attempt.totalPoints = grading.totalPoints.toFixed(2);
      attempt.passScore = quiz.passScore;
      attempt.passScorePoints = grading.passScorePoints;
      attempt.passed = grading.passed;
      attempt.status = grading.status;
      attempt.correctCount = grading.correctCount;
      attempt.wrongCount = grading.wrongCount;
      attempt.pendingEssayCount = grading.pendingEssayCount;
      attempt.submittedAt = submittedAt;
      attempt.isLate = grading.isLate;
      attempt.lateSeconds = grading.lateSeconds;

      const saved = await queryRunner.manager.save(QuizAttempt, attempt);
      await queryRunner.commitTransaction();

      if (saved.passed) {
        await (
          this.learningProgressService as LearningProgressWithQuizRecompute
        ).recomputeLessonAndEnrollmentProgress?.(learnerId, courseId, lessonId);
      }

      const result = this.toAttemptResult(saved);
      await this.recordQuizSubmissionEvent(
        learnerId,
        courseId,
        lessonId,
        result,
      );

      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async listAttempts(
    learnerId: string,
    courseId: string,
    lessonId: string,
    quizId: string,
  ): Promise<QuizAttemptResultResponse[]> {
    await this.loadAccessibleQuizContext(learnerId, courseId, lessonId, quizId);

    const attempts = await this.attemptsRepository.find({
      where: { learnerId, quizId, submittedAt: Not(IsNull()) },
      order: { submittedAt: 'DESC', createdAt: 'DESC' },
    });

    return attempts.map((attempt) => this.toAttemptResult(attempt));
  }

  private async loadAccessibleQuizContext(
    learnerId: string,
    courseId: string,
    lessonId: string,
    quizId?: string,
  ): Promise<QuizContext> {
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

    const lesson = await this.lessonsRepository.findOne({
      where: { id: lessonId, courseId },
    });
    if (!lesson) {
      throw new NotFoundException('Lesson not found');
    }

    const lessons = await this.lessonsRepository.find({
      where: { courseId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
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

    const quiz = await this.quizzesRepository.findOne({
      where: quizId ? { id: quizId, lessonId } : { lessonId },
      relations: { lesson: true, questions: true },
    });

    if (quizId && !quiz) {
      throw new NotFoundException('Quiz not found');
    }

    return { course, enrollment, lesson, quiz };
  }

  private toLearnerQuizResponse(quiz: Quiz): LearnerQuizResponse {
    const questions = this.getOrderedQuestions(quiz);
    const totalPoints = this.getTotalPoints(questions);

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
      questions: questions.map((question) => ({
        id: question.id,
        quizId: question.quizId,
        type: question.type,
        content: question.content,
        options: question.options ?? [],
        isMultipleChoice:
          question.type === QuestionType.MCQ &&
          (question.correctAnswers?.length ?? 0) > 1,
        maxSelectableOptions:
          question.type === QuestionType.MCQ
            ? Math.max(1, question.correctAnswers?.length ?? 0)
            : null,
        points: question.points,
        position: question.position,
      })),
    };
  }

  private gradeQuiz(
    quiz: Quiz,
    answers: SubmitQuizAnswerDto[],
    submittedAt: Date,
    startedAt: Date,
    timeLimitMinutes: number | null,
  ): GradingOutput {
    const orderedQuestions = this.getOrderedQuestions(quiz);
    const answerByQuestionId = this.normalizeAnswers(answers);
    const questionIds = new Set(
      orderedQuestions.map((question) => question.id),
    );
    for (const questionId of answerByQuestionId.keys()) {
      if (!questionIds.has(questionId)) {
        throw new BadRequestException(
          `Question ${questionId} does not belong to this quiz`,
        );
      }
    }
    const totalPoints = this.getTotalPoints(orderedQuestions);
    const passScorePoints = computePassScorePoints(totalPoints, quiz.passScore);
    const questions = orderedQuestions.map((question) => {
      const answer =
        answerByQuestionId.get(question.id) ??
        this.createMissingAnswer(question);

      return this.gradeQuestion(question, answer);
    });
    const totalScore = Number(
      questions.reduce((sum, question) => sum + question.score, 0).toFixed(2),
    );
    const passed = totalScore >= passScorePoints;
    const { isLate, lateSeconds } = this.computeLateness(
      startedAt,
      submittedAt,
      timeLimitMinutes,
    );

    return {
      answers,
      questions,
      totalScore,
      totalPoints,
      passScorePoints,
      passed,
      status: passed ? QuizAttemptStatus.PASSED : QuizAttemptStatus.NOT_PASSED,
      correctCount: questions.filter(
        (question) => question.status === 'correct',
      ).length,
      wrongCount: questions.filter(
        (question) =>
          question.type === QuestionType.MCQ && question.status !== 'correct',
      ).length,
      pendingEssayCount: questions.filter(
        (question) => question.status === 'pending_grading',
      ).length,
      isLate,
      lateSeconds,
    };
  }

  private normalizeAnswers(
    answers: SubmitQuizAnswerDto[],
  ): Map<string, SubmitQuizAnswerDto> {
    const answerByQuestionId = new Map<string, SubmitQuizAnswerDto>();
    for (const answer of answers) {
      if (answerByQuestionId.has(answer.questionId)) {
        throw new BadRequestException('Duplicate answer for question');
      }
      answerByQuestionId.set(answer.questionId, answer);
    }
    return answerByQuestionId;
  }

  private createMissingAnswer(question: Question): SubmitQuizAnswerDto {
    if (question.type === QuestionType.ESSAY) {
      return { questionId: question.id, text: '' };
    }

    return { questionId: question.id, selectedOptionIndexes: [] };
  }

  private gradeQuestion(
    question: Question,
    answer: SubmitQuizAnswerDto,
  ): QuizAttemptQuestionResult {
    if (question.type === QuestionType.ESSAY) {
      return {
        questionId: question.id,
        type: question.type,
        text: answer.text ?? '',
        score: 0,
        maxScore: question.points,
        isCorrect: false,
        status: 'pending_grading',
      };
    }

    const selectedOptionIndexes = [
      ...new Set(answer.selectedOptionIndexes ?? []),
    ];
    for (const index of selectedOptionIndexes) {
      if (index >= question.options.length) {
        throw new BadRequestException(
          'Selected option index is out of options range',
        );
      }
    }

    const correctAnswers = new Set(question.correctAnswers ?? []);
    if (
      correctAnswers.size > 0 &&
      selectedOptionIndexes.length > correctAnswers.size
    ) {
      throw new BadRequestException(
        'Selected option count exceeds the allowed answer count',
      );
    }

    const selectedCorrectCount = selectedOptionIndexes.filter((index) =>
      correctAnswers.has(index),
    ).length;
    const score =
      correctAnswers.size > 0
        ? question.points * (selectedCorrectCount / correctAnswers.size)
        : 0;
    const roundedScore = Number(score.toFixed(2));
    const isCorrect = selectedCorrectCount === correctAnswers.size;

    return {
      questionId: question.id,
      type: question.type,
      selectedOptionIndexes,
      score: roundedScore,
      maxScore: question.points,
      isCorrect,
      status:
        roundedScore === question.points
          ? 'correct'
          : roundedScore > 0
            ? 'partial'
            : 'wrong',
    };
  }

  private computeLateness(
    startedAt: Date,
    submittedAt: Date,
    timeLimitMinutes: number | null,
  ): { isLate: boolean; lateSeconds: number } {
    if (!timeLimitMinutes) {
      return { isLate: false, lateSeconds: 0 };
    }

    const deadline = startedAt.getTime() + timeLimitMinutes * 60 * 1000;
    const lateMilliseconds = submittedAt.getTime() - deadline;
    if (lateMilliseconds <= 0) {
      return { isLate: false, lateSeconds: 0 };
    }

    return {
      isLate: true,
      lateSeconds: Math.floor(lateMilliseconds / 1000),
    };
  }

  private computeExpiresAt(
    startedAt: Date,
    timeLimitMinutes: number | null,
  ): Date {
    const timeLimitMilliseconds =
      (timeLimitMinutes ?? 0) * MILLISECONDS_PER_MINUTE;
    const expiryBufferMilliseconds =
      ATTEMPT_EXPIRY_BUFFER_HOURS * MILLISECONDS_PER_HOUR;

    return new Date(
      startedAt.getTime() + timeLimitMilliseconds + expiryBufferMilliseconds,
    );
  }

  private getAttemptExpiresAt(attempt: QuizAttempt, fallbackStart: Date): Date {
    return (
      attempt.expiresAt ??
      this.computeExpiresAt(
        attempt.startedAt ?? fallbackStart,
        attempt.timeLimitMinutes,
      )
    );
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

  private async recordQuizSubmissionEvent(
    learnerId: string,
    courseId: string,
    lessonId: string,
    result: QuizAttemptResultResponse,
  ): Promise<void> {
    await this.analyticsEventsRepository.save(
      this.analyticsEventsRepository.create({
        learnerId,
        courseId,
        lessonId,
        eventType: 'quiz_submitted',
        payload: {
          quizId: result.quizId,
          attemptId: result.attemptId,
          totalScore: result.totalScore,
          totalPoints: result.totalPoints,
          passed: result.passed,
          isLate: result.isLate,
          lateSeconds: result.lateSeconds,
        },
        clientCreatedAt: null,
      }),
    );
  }

  private getOrderedQuestions(quiz: Quiz): Question[] {
    return [...(quiz.questions ?? [])].sort(
      (a, b) =>
        a.position - b.position ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  private getTotalPoints(questions: Question[]): number {
    return questions.reduce((sum, question) => sum + question.points, 0);
  }
}
