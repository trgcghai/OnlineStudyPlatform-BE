import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ChatMessageRole } from '../entities/chat-message.entity';

export class CreateChatMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  question!: string;
}

export interface ChatMessageResponse {
  id: string;
  role: ChatMessageRole;
  content: string;
  inScope: boolean | null;
  similarity: number | null;
  citations: ChatCitationResponse[];
  createdAt: Date;
}

export interface ChatCitationResponse {
  lessonId: string | null;
  lessonTitle: string;
  excerpt: string;
  sourceType?: 'transcript' | 'material';
  locator?: string | null;
}

export interface ChatSessionResponse {
  sessionId: string;
  isAiAvailable: boolean;
  messages: ChatMessageResponse[];
}

export interface ChatSendResponse extends ChatSessionResponse {
  reply: ChatMessageResponse;
}

export interface AiChatHistoryMessage {
  role: ChatMessageRole;
  content: string;
}

export interface AiChatRequest {
  learnerId: string;
  courseId: string;
  question: string;
  similarityThreshold: number;
  history: AiChatHistoryMessage[];
}

export interface AiChatResponse {
  answer: string;
  inScope: boolean;
  similarity: number;
  citations: ChatCitationResponse[];
}
