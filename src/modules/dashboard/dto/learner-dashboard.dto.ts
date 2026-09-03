export type LearnerDashboardCourseStatus = 'in_progress' | 'completed';

export interface LearnerDashboardResponse {
  summary: LearnerDashboardSummaryResponse;
  courses: LearnerDashboardCourseResponse[];
  recentActivities: LearnerDashboardRecentActivityResponse[];
}

export interface LearnerDashboardSummaryResponse {
  enrolledCourseCount: number;
  completedCourseCount: number;
  averageProgressPercent: number;
  averageQuizScorePercent: number | null;
}

export interface LearnerDashboardCourseResponse {
  enrollmentId: string;
  courseId: string;
  title: string;
  thumbnail: string | null;
  category: string;
  instructorName: string | null;
  progressPercent: number;
  completionRatePercent: number;
  status: LearnerDashboardCourseStatus;
  bestQuizScorePercent: number | null;
  bestQuizAttempt: LearnerDashboardBestQuizAttemptResponse | null;
  continueLearning: LearnerDashboardContinueLearningResponse;
}

export interface LearnerDashboardBestQuizAttemptResponse {
  quizId: string;
  attemptId: string;
  score: number;
  totalPoints: number;
  submittedAt: Date;
  passed: boolean;
}

export interface LearnerDashboardContinueLearningResponse {
  courseId: string;
  lessonId: string | null;
  href: string;
}

export interface LearnerDashboardRecentActivityResponse {
  id: string;
  courseId: string;
  lessonId: string | null;
  courseTitle: string;
  lessonTitle: string | null;
  eventType: string;
  occurredAt: Date;
}
