export interface AiSummaryJobData {
  lessonId: string;
  videoUrl: string;
}

export interface AiTranscribeRequest {
  lessonId: string;
  audioUrl: string;
}

export interface AiTranscribeResponse {
  transcript: string;
  language: string;
  durationSeconds: number;
}

export interface AiSummarizeRequest {
  lessonId: string;
  title: string;
  transcript: string;
}

export interface AiSummarizeResponse {
  summary: string;
  provider: 'gemini';
}
