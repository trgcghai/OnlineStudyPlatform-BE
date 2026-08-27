export interface EnrollmentCourseInstructorResponse {
  id: string;
  name: string;
}

export interface EnrollmentCourseResponse {
  id: string;
  title: string;
  description: string;
  category: string;
  thumbnail: string | null;
  instructorId: string;
  instructor?: EnrollmentCourseInstructorResponse;
}

export interface EnrollmentResponse {
  id: string;
  learnerId: string;
  courseId: string;
  progress: string;
  enrolledAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
  course?: EnrollmentCourseResponse;
}
