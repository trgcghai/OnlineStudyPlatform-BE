export const CERTIFICATE_QUEUE = 'certificates';
export const CERTIFICATE_JOB = 'issue-certificate';

export interface CertificateJobData {
  learnerId: string;
  courseId: string;
}
