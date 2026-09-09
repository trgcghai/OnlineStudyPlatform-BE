import type { LessonResponse } from '../../lessons/dto/lesson.dto';
import type { QuizSummaryResponse } from '../../quizzes/dto/quiz.dto';

export interface AdminCourseLessonItem {
  lesson: LessonResponse;
  quiz: QuizSummaryResponse | null;
}

export interface AdminCourseContentListResult {
  items: AdminCourseLessonItem[];
  total: number;
  courseId: string;
  courseTitle: string;
}
