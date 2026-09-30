import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import {
  AI_UNAVAILABLE_MESSAGE,
  AiChatGatewayService,
} from './ai-chat-gateway.service';
import {
  AiChatHistoryMessage,
  ChatMessageResponse,
  ChatSendResponse,
  ChatSessionResponse,
} from './dto/ai-chat.dto';
import {
  ChatCitationPayload,
  ChatMessage,
  ChatMessageRole,
} from './entities/chat-message.entity';
import { ChatSession } from './entities/chat-session.entity';

const HISTORY_LIMIT = 12;
const DEFAULT_SIMILARITY_THRESHOLD = 0.2;

@Injectable()
export class AiChatService {
  constructor(
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    @InjectRepository(Enrollment)
    private readonly enrollmentsRepository: Repository<Enrollment>,
    @InjectRepository(ChatSession)
    private readonly sessionsRepository: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly messagesRepository: Repository<ChatMessage>,
    private readonly gateway: AiChatGatewayService,
    private readonly configService: ConfigService,
  ) {}

  async getSession(
    learnerId: string,
    courseId: string,
  ): Promise<ChatSessionResponse> {
    await this.assertLearnerCanChat(learnerId, courseId);
    const session = await this.getOrCreateSession(learnerId, courseId);
    const messages = await this.loadSessionMessages(session.id);

    return {
      sessionId: session.id,
      isAiAvailable: Boolean(this.configService.get<string>('AI_URL')),
      messages: messages.map((message) => this.toMessageResponse(message)),
    };
  }

  async sendMessage(
    learnerId: string,
    courseId: string,
    question: string,
  ): Promise<ChatSendResponse> {
    await this.assertLearnerCanChat(learnerId, courseId);
    const session = await this.getOrCreateSession(learnerId, courseId);
    const historyMessages = await this.loadSessionMessages(session.id);
    const userMessage = await this.messagesRepository.save(
      this.messagesRepository.create({
        sessionId: session.id,
        role: ChatMessageRole.USER,
        content: question.trim(),
        inScope: null,
        similarity: null,
        citations: [],
      }),
    );

    const aiResponse = await this.gateway.chat({
      learnerId,
      courseId,
      question: question.trim(),
      similarityThreshold: this.getSimilarityThreshold(),
      history: this.toHistory(historyMessages),
    });

    const assistantMessage = await this.messagesRepository.save(
      this.messagesRepository.create({
        sessionId: session.id,
        role: ChatMessageRole.ASSISTANT,
        content: aiResponse?.answer ?? AI_UNAVAILABLE_MESSAGE,
        inScope: aiResponse?.inScope ?? null,
        similarity:
          aiResponse?.similarity === undefined
            ? null
            : aiResponse.similarity.toFixed(4),
        citations: aiResponse?.citations ?? [],
      }),
    );
    const messages = [...historyMessages, userMessage, assistantMessage];

    return {
      sessionId: session.id,
      isAiAvailable: Boolean(aiResponse),
      messages: messages.map((message) => this.toMessageResponse(message)),
      reply: this.toMessageResponse(assistantMessage),
    };
  }

  private async assertLearnerCanChat(learnerId: string, courseId: string) {
    const course = await this.coursesRepository.findOne({
      where: { id: courseId },
    });

    if (!course || course.status !== CourseStatus.PUBLISHED) {
      throw new NotFoundException('Course not found');
    }

    const enrollment = await this.enrollmentsRepository.findOne({
      where: { learnerId, courseId },
    });

    if (!enrollment) {
      throw new ForbiddenException('Bạn cần đăng ký khóa học để dùng chatbot');
    }

    return course;
  }

  private async getOrCreateSession(
    learnerId: string,
    courseId: string,
  ): Promise<ChatSession> {
    const existing = await this.sessionsRepository.findOne({
      where: { learnerId, courseId },
    });

    if (existing) return existing;

    return this.sessionsRepository.save(
      this.sessionsRepository.create({ learnerId, courseId }),
    );
  }

  private loadSessionMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.messagesRepository.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
      take: 100,
    });
  }

  private toHistory(messages: ChatMessage[]): AiChatHistoryMessage[] {
    return messages.slice(-HISTORY_LIMIT).map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  private getSimilarityThreshold(): number {
    const configured = this.configService.get<string | number>(
      'AI_CHAT_SIMILARITY_THRESHOLD',
    );
    const parsed =
      typeof configured === 'number' ? configured : Number(configured);

    if (Number.isNaN(parsed)) {
      return DEFAULT_SIMILARITY_THRESHOLD;
    }

    return Math.min(Math.max(parsed, 0), 1);
  }

  private toMessageResponse(message: ChatMessage): ChatMessageResponse {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      inScope: message.inScope,
      similarity:
        message.similarity === null ? null : Number(message.similarity),
      citations: (message.citations ?? []).map(
        (citation: ChatCitationPayload) => ({
          lessonId: citation.lessonId,
          lessonTitle: citation.lessonTitle,
          excerpt: citation.excerpt,
          sourceType: citation.sourceType,
          locator: citation.locator,
        }),
      ),
      createdAt: message.createdAt,
    };
  }
}
