import { Injectable } from '@nestjs/common';
import { CourseLearningOrder } from '../courses/entities/course.entity';
import { Lesson } from '../lessons/entities/lesson.entity';

export interface LessonAccessDecision {
  allowed: boolean;
  message: string;
}

export const SEQUENTIAL_BLOCK_MESSAGE = 'Hoàn thành bài học trước để tiếp tục';

@Injectable()
export class LearningAccessService {
  /**
   * Decides whether a learner may open `targetLesson` given the ordered list
   * of lessons in the course and the set of completed lesson ids.
   *
   * - `free` order: every lesson is accessible regardless of progress.
   * - `sequential` order: the learner must have completed every lesson with a
   *   lower `position` before opening `targetLesson`.
   *
   * This is the API-level gating rule. It is independent of how completed
   * lessons are recorded, so the
   * completed set is passed in explicitly and the rule stays unit-testable.
   */
  determineLessonAccess(
    courseLearningOrder: CourseLearningOrder,
    targetLesson: Lesson,
    lessonsInCourse: ReadonlyArray<Lesson>,
    completedLessonIds: ReadonlySet<string>,
  ): LessonAccessDecision {
    if (courseLearningOrder === CourseLearningOrder.FREE) {
      return { allowed: true, message: '' };
    }

    const hasIncompletePriorLesson = lessonsInCourse.some(
      (lesson) =>
        lesson.position < targetLesson.position &&
        !completedLessonIds.has(lesson.id),
    );

    if (hasIncompletePriorLesson) {
      return { allowed: false, message: SEQUENTIAL_BLOCK_MESSAGE };
    }

    return { allowed: true, message: '' };
  }
}
