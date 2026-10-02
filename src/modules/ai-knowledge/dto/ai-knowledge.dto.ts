import { KnowledgeSourceType } from '../entities/lesson-knowledge-source.entity';

export interface AiKnowledgeIndexJobData {
  action: 'index';
  sourceId: string;
  contentHash: string;
}

export interface AiKnowledgeDeleteSourceJobData {
  action: 'delete-source';
  sourceId: string;
}

export interface AiKnowledgeDeleteCourseJobData {
  action: 'delete-course';
  courseId: string;
}

export type AiKnowledgeJobData =
  | AiKnowledgeIndexJobData
  | AiKnowledgeDeleteSourceJobData
  | AiKnowledgeDeleteCourseJobData;

export interface AiKnowledgeIndexRequest {
  sourceId: string;
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  sourceType: KnowledgeSourceType;
  contentHash: string;
  sourceUrl?: string;
  transcript?: string;
}

export interface AiKnowledgeIndexResponse {
  sourceId: string;
  contentHash: string;
  chunkCount: number;
}
