export interface AdminDashboardResponse {
  users: {
    total: number;
    learners: number;
    instructors: number;
    admins: number;
  };
  courses: {
    total: number;
    published: number;
    pending: number;
  };
  enrollments: {
    total: number;
    completed: number;
    completionRate: number;
  };
  learningRisk: {
    scoredEnrollments: number;
    low: number;
    medium: number;
    high: number;
  };
}
