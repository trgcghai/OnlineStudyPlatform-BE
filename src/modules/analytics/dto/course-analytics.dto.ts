export interface CourseAnalyticsResponse {
  courseId: string;
  generatedAt: string;
  progress: {
    enrollmentCount: number;
    averageProgressPercent: number;
    completedEnrollmentCount: number;
    completionRatePercent: number;
  };
  engagement: {
    periodStart: string;
    periodEndExclusive: string;
    activeLearnerCount: number;
    eventCount: number;
    engagementScorePercent: number;
  };
  quizPerformance: {
    gradedAttemptCount: number;
    averageScorePercent: number | null;
    passRatePercent: number | null;
  };
}
