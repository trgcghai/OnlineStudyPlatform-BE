import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Course } from '../../modules/courses/entities/course.entity';
import { Lesson } from '../../modules/lessons/entities/lesson.entity';
import {
  Question,
  QuestionType,
} from '../../modules/quizzes/entities/question.entity';
import { Quiz } from '../../modules/quizzes/entities/quiz.entity';

interface LessonTemplate {
  title: string;
  description: string;
  duration: number;
  videoUrl: string;
}

interface QuestionTemplate {
  content: string;
  type: QuestionType;
  options: string[];
  correctAnswers: number[];
  points: number;
}

interface QuizTemplate {
  lessonPosition: number;
  title: string;
  description: string;
  timeLimitMinutes: number | null;
  passScore: number;
  questions: QuestionTemplate[];
}

const LESSONS_PER_COURSE = 10;
const SAMPLE_VIDEO_URL = 'https://samplelib.com/lib/preview/mp4/sample-30s.mp4';
const SAMPLE_VIDEO_DURATION_SECONDS = 30;

const LESSON_TEMPLATES: LessonTemplate[] = [
  {
    title: 'Overview And Learning Path',
    description: 'Understand the goals, prerequisites, and final outcomes.',
    duration: SAMPLE_VIDEO_DURATION_SECONDS,
    videoUrl: SAMPLE_VIDEO_URL,
  },
  {
    title: 'Core Concepts',
    description: 'Learn the vocabulary and mental model for the topic.',
    duration: SAMPLE_VIDEO_DURATION_SECONDS,
    videoUrl: SAMPLE_VIDEO_URL,
  },
  {
    title: 'Hands-On Setup',
    description: 'Prepare the tools and workspace used throughout the course.',
    duration: SAMPLE_VIDEO_DURATION_SECONDS,
    videoUrl: SAMPLE_VIDEO_URL,
  },
  {
    title: 'Guided Practice',
    description: 'Follow a complete worked example from start to finish.',
    duration: SAMPLE_VIDEO_DURATION_SECONDS,
    videoUrl: SAMPLE_VIDEO_URL,
  },
  {
    title: 'Common Mistakes',
    description: 'Review common mistakes and learn how to avoid them.',
    duration: SAMPLE_VIDEO_DURATION_SECONDS,
    videoUrl: SAMPLE_VIDEO_URL,
  },
  {
    title: 'Applied Workflow',
    description: 'Apply the lesson content in a practical workflow.',
    duration: SAMPLE_VIDEO_DURATION_SECONDS,
    videoUrl: SAMPLE_VIDEO_URL,
  },
  {
    title: 'Problem Solving Lab',
    description: 'Practice solving realistic problems with structured steps.',
    duration: SAMPLE_VIDEO_DURATION_SECONDS,
    videoUrl: SAMPLE_VIDEO_URL,
  },
  {
    title: 'Review And Refinement',
    description: 'Improve your solution and review key trade-offs.',
    duration: SAMPLE_VIDEO_DURATION_SECONDS,
    videoUrl: SAMPLE_VIDEO_URL,
  },
  {
    title: 'Mini Project',
    description: 'Build a small outcome that combines previous lessons.',
    duration: SAMPLE_VIDEO_DURATION_SECONDS,
    videoUrl: SAMPLE_VIDEO_URL,
  },
  {
    title: 'Final Review',
    description: 'Summarize the course and plan the next practice steps.',
    duration: SAMPLE_VIDEO_DURATION_SECONDS,
    videoUrl: SAMPLE_VIDEO_URL,
  },
];

function mcq(
  content: string,
  options: string[],
  correctAnswers: number[],
  points = 1,
): QuestionTemplate {
  return {
    content,
    type: QuestionType.MCQ,
    options,
    correctAnswers,
    points,
  };
}

function essay(content: string, points = 2): QuestionTemplate {
  return {
    content,
    type: QuestionType.ESSAY,
    options: [],
    correctAnswers: [],
    points,
  };
}

function buildQuizTemplates(
  courseTitle: string,
  courseIndex: number,
): QuizTemplate[] {
  const quizOffset = courseIndex % 3;

  return [
    {
      lessonPosition: 1,
      title: `${courseTitle} - Concept Check`,
      description: 'Quick MCQ check for early lesson concepts.',
      timeLimitMinutes: 8 + quizOffset,
      passScore: 60,
      questions: [
        mcq(
          'Which statement best describes the main lesson objective?',
          [
            'Memorize unrelated facts',
            'Understand and apply the core idea',
            'Skip practice and move to the project',
            'Focus only on definitions',
          ],
          [1],
        ),
        mcq(
          'Which habit supports effective learning in this course?',
          [
            'Practice after each lesson',
            'Ignore feedback',
            'Avoid reviewing mistakes',
            'Only watch the final lesson',
          ],
          [0],
        ),
        mcq(
          'Select the useful preparation steps.',
          [
            'Check prerequisites',
            'Prepare the workspace',
            'Disable all notes',
            'Review expected outcomes',
          ],
          [0, 1, 3],
          2,
        ),
      ],
    },
    {
      lessonPosition: 3,
      title: `${courseTitle} - Practice Reflection`,
      description: 'Short written reflection after the guided practice lesson.',
      timeLimitMinutes: null,
      passScore: 70,
      questions: [
        essay('Explain the most important step in the guided workflow.', 3),
        essay(
          'Describe one mistake you would watch for in your own practice.',
          2,
        ),
      ],
    },
    {
      lessonPosition: 6,
      title: `${courseTitle} - Applied Knowledge Quiz`,
      description: 'Mixed quiz covering practical decisions and explanations.',
      timeLimitMinutes: 15 + quizOffset * 5,
      passScore: 75,
      questions: [
        mcq(
          'What should you do before applying a new technique?',
          [
            'Clarify the goal',
            'Copy the first available answer',
            'Ignore constraints',
            'Delete previous work immediately',
          ],
          [0],
        ),
        mcq(
          'Which signals indicate a solution should be refined?',
          [
            'It solves the wrong problem',
            'It is hard to explain',
            'It meets the requirements clearly',
            'It creates unnecessary steps',
          ],
          [0, 1, 3],
          2,
        ),
        essay('Summarize how you would apply this workflow to a real task.', 3),
        mcq(
          'What is the safest way to evaluate a change?',
          [
            'Verify against the expected outcome',
            'Assume it works',
            'Skip review',
            'Rely only on memory',
          ],
          [0],
        ),
      ],
    },
    {
      lessonPosition: 8,
      title: `${courseTitle} - Mini Project Review`,
      description: 'Final checkpoint for the mini project lesson.',
      timeLimitMinutes: 25 + quizOffset * 5,
      passScore: 80,
      questions: [
        essay('Describe the outcome you built in the mini project.', 3),
        mcq(
          'Which items belong in a final review?',
          [
            'What worked well',
            'Open risks',
            'Random unrelated tasks',
            'Next improvement steps',
          ],
          [0, 1, 3],
          2,
        ),
        mcq(
          'What does a strong course completion plan include?',
          [
            'More deliberate practice',
            'Ignoring weak areas',
            'A concrete next step',
            'Feedback review',
          ],
          [0, 2, 3],
          2,
        ),
        essay('What would you improve if you repeated the project?', 2),
        mcq(
          'When should you revisit earlier lessons?',
          [
            'When a concept blocks progress',
            'Never',
            'Only after forgetting everything',
            'When reviewing mistakes',
          ],
          [0, 3],
        ),
      ],
    },
  ];
}

@Injectable()
export class LessonQuizSeed {
  private readonly logger = new Logger(LessonQuizSeed.name);

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

  async seedLessonsAndQuizzes(instructorId: string): Promise<void> {
    const courses = await this.coursesRepository.find({
      where: { instructorId },
      order: { createdAt: 'ASC' },
    });

    let seededCourseCount = 0;

    for (const [courseIndex, course] of courses.entries()) {
      const existingLessons = await this.lessonsRepository.find({
        where: { courseId: course.id },
      });

      if (existingLessons.length >= LESSONS_PER_COURSE) {
        continue;
      }

      if (existingLessons.length > 0) {
        await this.lessonsRepository.delete({ courseId: course.id });
      }

      const lessons = await this.lessonsRepository.save(
        LESSON_TEMPLATES.map((lessonTemplate, lessonIndex) =>
          this.lessonsRepository.create({
            title: `${lessonIndex + 1}. ${lessonTemplate.title}`,
            description: `${lessonTemplate.description} Course: ${course.title}.`,
            videoUrl: lessonTemplate.videoUrl,
            materialUrl: null,
            duration: lessonTemplate.duration,
            position: lessonIndex,
            courseId: course.id,
          }),
        ),
      );

      await this.seedQuizzes(course, courseIndex, lessons);
      seededCourseCount += 1;
    }

    if (seededCourseCount > 0) {
      this.logger.log(
        `Created lessons and quizzes for ${seededCourseCount} sample courses`,
      );
    }
  }

  private async seedQuizzes(
    course: Course,
    courseIndex: number,
    lessons: Lesson[],
  ): Promise<void> {
    const lessonsByPosition = new Map(
      lessons.map((lesson) => [lesson.position, lesson]),
    );

    for (const quizTemplate of buildQuizTemplates(course.title, courseIndex)) {
      const lesson = lessonsByPosition.get(quizTemplate.lessonPosition);
      if (!lesson) continue;

      const quiz = await this.quizzesRepository.save(
        this.quizzesRepository.create({
          lessonId: lesson.id,
          title: quizTemplate.title,
          description: quizTemplate.description,
          timeLimitMinutes: quizTemplate.timeLimitMinutes,
          passScore: quizTemplate.passScore,
        }),
      );

      await this.questionsRepository.save(
        quizTemplate.questions.map((questionTemplate, questionIndex) =>
          this.questionsRepository.create({
            quizId: quiz.id,
            content: questionTemplate.content,
            type: questionTemplate.type,
            options: questionTemplate.options,
            correctAnswers: questionTemplate.correctAnswers,
            points: questionTemplate.points,
            position: questionIndex,
          }),
        ),
      );
    }
  }
}
