import { CourseLearningOrder } from '../../courses/entities/course.entity';

export interface LearningCourseSummaryResponse {
  id: string;
  title: string;
  description: string;
  thumbnail: string | null;
  learningOrder: CourseLearningOrder;
}

export interface LearningEnrollmentResponse {
  id: string;
  progress: string;
  enrolledAt: Date;
  completedAt: Date | null;
}

export interface LearningLessonSummaryResponse {
  id: string;
  title: string;
  description: string;
  duration: number;
  position: number;
  isAccessible: boolean;
  isCompleted: boolean;
  blockedReason: string | null;
}

export interface LearningCourseResponse {
  course: LearningCourseSummaryResponse;
  enrollment: LearningEnrollmentResponse;
  lessons: LearningLessonSummaryResponse[];
  firstAccessibleLessonId: string | null;
}

export interface LearningLessonDetailResponse extends LearningLessonSummaryResponse {
  courseId: string;
  videoUrl: string | null;
  materialUrl: string | null;
}

export interface LearningLessonProgressResponse {
  lessonId: string;
  watchedSeconds: number;
  lastPositionSeconds: number;
  watchRatio: number;
  isWatchComplete: boolean;
  isLessonComplete: boolean;
  completedAt: Date | null;
}

export interface LearningWatchEventResponse {
  lessonProgress: LearningLessonProgressResponse;
  enrollment: LearningEnrollmentResponse;
}
