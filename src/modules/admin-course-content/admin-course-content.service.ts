import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Course } from '../courses/entities/course.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import type { LessonResponse } from '../lessons/dto/lesson.dto';
import type { QuizSummaryResponse } from '../quizzes/dto/quiz.dto';
import { Question } from '../quizzes/entities/question.entity';
import { Quiz } from '../quizzes/entities/quiz.entity';
import type { AdminCourseContentListResult } from './dto/admin-course-content.dto';

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
export class AdminCourseContentService {
  constructor(
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    @InjectRepository(Lesson)
    private readonly lessonsRepository: Repository<Lesson>,
    @InjectRepository(Quiz)
    private readonly quizzesRepository: Repository<Quiz>,
    @InjectRepository(Question)
    private readonly questionsRepository: Repository<Question>,
  ) {}

  async listLessonsWithQuizzes(
    courseId: string,
  ): Promise<AdminCourseContentListResult> {
    const course = await this.coursesRepository.findOne({
      where: { id: courseId },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    const lessons = await this.lessonsRepository.find({
      where: { courseId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });

    const lessonIds = lessons.map((lesson) => lesson.id);
    const quizzes =
      lessonIds.length === 0
        ? []
        : await this.quizzesRepository.find({
            where: { lessonId: In(lessonIds) },
          });

    const quizIds = quizzes.map((quiz) => quiz.id);
    const questions =
      quizIds.length === 0
        ? []
        : await this.questionsRepository.find({
            where: { quizId: In(quizIds) },
          });

    const quizByLesson = new Map<string, Quiz>();
    for (const quiz of quizzes) {
      quizByLesson.set(quiz.lessonId, quiz);
    }

    const questionsByQuiz = new Map<string, Question[]>();
    for (const quiz of quizzes) {
      questionsByQuiz.set(quiz.id, []);
    }
    for (const question of questions) {
      const existing = questionsByQuiz.get(question.quizId);
      if (existing) {
        existing.push(question);
      }
    }

    const items = lessons.map((lesson) => {
      const quiz = quizByLesson.get(lesson.id) ?? null;
      const quizQuestions = quiz ? (questionsByQuiz.get(quiz.id) ?? []) : [];
      const totalPoints = quizQuestions.reduce(
        (sum, question) => sum + question.points,
        0,
      );

      return {
        lesson: this.toLessonResponse(lesson),
        quiz: quiz
          ? this.toQuizSummaryResponse(
              quiz,
              courseId,
              quizQuestions.length,
              totalPoints,
            )
          : null,
      };
    });

    return {
      items,
      total: items.length,
      courseId,
      courseTitle: course.title,
    };
  }

  private toLessonResponse(lesson: Lesson): LessonResponse {
    return {
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      videoUrl: lesson.videoUrl,
      materialUrl: lesson.materialUrl,
      duration: lesson.duration,
      position: lesson.position,
      courseId: lesson.courseId,
      createdAt: lesson.createdAt,
      updatedAt: lesson.updatedAt,
    };
  }

  private toQuizSummaryResponse(
    quiz: Quiz,
    courseId: string,
    questionCount: number,
    totalPoints: number,
  ): QuizSummaryResponse {
    return {
      id: quiz.id,
      lessonId: quiz.lessonId,
      courseId,
      title: quiz.title,
      description: quiz.description,
      timeLimitMinutes: quiz.timeLimitMinutes,
      passScore: quiz.passScore,
      totalPoints,
      passScorePoints: computePassScorePoints(totalPoints, quiz.passScore),
      questionCount,
      createdAt: quiz.createdAt,
      updatedAt: quiz.updatedAt,
    };
  }
}
