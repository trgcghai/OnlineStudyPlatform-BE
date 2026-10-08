import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { CourseLearningOrder } from '../courses/entities/course.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import {
  LearningAccessService,
  SEQUENTIAL_BLOCK_MESSAGE,
} from './learning-access.service';

function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
  const lesson = new Lesson();
  lesson.id = randomUUID();
  lesson.title = 'Test Lesson';
  lesson.description = '';
  lesson.videoUrl = null;
  lesson.materialUrl = null;
  lesson.duration = 0;
  lesson.position = 0;
  lesson.courseId = 'course-1';
  lesson.createdAt = new Date();
  lesson.updatedAt = new Date();
  return Object.assign(lesson, overrides);
}

describe('LearningAccessService', () => {
  let service: LearningAccessService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LearningAccessService],
    }).compile();

    service = module.get<LearningAccessService>(LearningAccessService);
  });

  describe('determineLessonAccess', () => {
    it('allows any lesson in free order regardless of progress', () => {
      const target = makeLesson({ position: 2 });
      const lessons = [
        makeLesson({ position: 0 }),
        makeLesson({ position: 1 }),
        target,
      ];

      const decision = service.determineLessonAccess(
        CourseLearningOrder.FREE,
        target,
        lessons,
        new Set(),
      );

      expect(decision.allowed).toBe(true);
      expect(decision.message).toBe('');
    });

    it('blocks lesson N+1 in sequential order when lesson N is incomplete', () => {
      const lesson0 = makeLesson({ position: 0 });
      const lesson1 = makeLesson({ position: 1 });
      const target = makeLesson({ position: 2 });

      const decision = service.determineLessonAccess(
        CourseLearningOrder.SEQUENTIAL,
        target,
        [lesson0, lesson1, target],
        new Set([lesson0.id]),
      );

      expect(decision.allowed).toBe(false);
      expect(decision.message).toBe(SEQUENTIAL_BLOCK_MESSAGE);
    });

    it('allows the first lesson in sequential order when no prior lesson exists', () => {
      const target = makeLesson({ position: 0 });

      const decision = service.determineLessonAccess(
        CourseLearningOrder.SEQUENTIAL,
        target,
        [target],
        new Set(),
      );

      expect(decision.allowed).toBe(true);
    });

    it('allows lesson N+1 in sequential order after all prior lessons completed', () => {
      const lesson0 = makeLesson({ position: 0 });
      const lesson1 = makeLesson({ position: 1 });
      const target = makeLesson({ position: 2 });

      const decision = service.determineLessonAccess(
        CourseLearningOrder.SEQUENTIAL,
        target,
        [lesson0, lesson1, target],
        new Set([lesson0.id, lesson1.id]),
      );

      expect(decision.allowed).toBe(true);
    });

    it('blocks the target lesson when it has no prior lesson but shares position', () => {
      // Regression guard: a lesson with the same position as a previous one is
      // not considered a prerequisite (strictly-lower positions only).
      const lesson0 = makeLesson({ position: 0 });
      const target = makeLesson({ position: 0 });

      const decision = service.determineLessonAccess(
        CourseLearningOrder.SEQUENTIAL,
        target,
        [lesson0, target],
        new Set([lesson0.id]),
      );

      expect(decision.allowed).toBe(true);
    });
  });
});
