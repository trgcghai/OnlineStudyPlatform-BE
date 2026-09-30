import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { AiChatGatewayService } from './ai-chat-gateway.service';
import { AiChatService } from './ai-chat.service';
import { ChatMessage, ChatMessageRole } from './entities/chat-message.entity';
import { ChatSession } from './entities/chat-session.entity';

describe('AiChatService', () => {
  let service: AiChatService;
  let coursesRepository: { findOne: jest.Mock };
  let enrollmentsRepository: { findOne: jest.Mock };
  let sessionsRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let messagesRepository: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let gateway: { chat: jest.Mock };
  let configService: { get: jest.Mock };

  const learnerId = '11111111-1111-4111-8111-111111111111';
  const courseId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const now = new Date('2026-09-14T00:00:00.000Z');

  const course = {
    id: courseId,
    title: 'NestJS co ban',
    description: 'Dependency injection va module',
    category: 'Backend',
    status: CourseStatus.PUBLISHED,
  } as Course;
  const lesson = {
    id: '44444444-4444-4444-8444-444444444444',
    title: 'Provider',
    description: 'Provider giup tach service trong NestJS',
    materialUrl: 'http://localhost:9000/material.pdf',
    videoUrl: 'http://localhost:9000/video.mp4',
  } as Lesson;
  const session = {
    id: sessionId,
    learnerId,
    courseId,
    createdAt: now,
    updatedAt: now,
  } as ChatSession;

  beforeEach(() => {
    coursesRepository = { findOne: jest.fn().mockResolvedValue(course) };
    enrollmentsRepository = {
      findOne: jest.fn().mockResolvedValue({ learnerId, courseId }),
    };
    sessionsRepository = {
      findOne: jest.fn().mockResolvedValue(session),
      create: jest.fn((payload) => payload),
      save: jest.fn((payload) =>
        Promise.resolve({ ...payload, id: sessionId }),
      ),
    };
    messagesRepository = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((payload) => payload),
      save: jest.fn((payload) =>
        Promise.resolve({
          ...payload,
          id: `${payload.role}-message`,
          createdAt: now,
        }),
      ),
    };
    gateway = {
      chat: jest.fn().mockResolvedValue({
        answer: 'Provider la thanh phan duoc tiem qua dependency injection.',
        inScope: true,
        similarity: 0.5,
        citations: [
          {
            lessonId: lesson.id,
            lessonTitle: lesson.title,
            excerpt: lesson.description,
          },
        ],
      }),
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'AI_URL') return 'http://ai:8000';
        if (key === 'AI_CHAT_SIMILARITY_THRESHOLD') return 0.3;
        return undefined;
      }),
    };
    service = new AiChatService(
      coursesRepository as unknown as Repository<Course>,
      enrollmentsRepository as unknown as Repository<Enrollment>,
      sessionsRepository as unknown as Repository<ChatSession>,
      messagesRepository as unknown as Repository<ChatMessage>,
      gateway as unknown as AiChatGatewayService,
      configService as unknown as ConfigService,
    );
  });

  it('sends learner/course scope, persisted history, and threshold to AI', async () => {
    const previousMessage = {
      id: 'previous-user-message',
      sessionId,
      role: ChatMessageRole.USER,
      content: 'Provider la gi?',
      inScope: null,
      similarity: null,
      citations: [],
      createdAt: now,
    } as ChatMessage;
    messagesRepository.find.mockResolvedValue([previousMessage]);

    const result = await service.sendMessage(
      learnerId,
      courseId,
      'Dependency injection dung the nao?',
    );

    expect(gateway.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        learnerId,
        courseId,
        question: 'Dependency injection dung the nao?',
        similarityThreshold: 0.3,
        history: [{ role: ChatMessageRole.USER, content: 'Provider la gi?' }],
      }),
    );
    expect(gateway.chat.mock.calls[0][0]).not.toHaveProperty('sources');
    expect(result.isAiAvailable).toBe(true);
    expect(result.reply).toEqual(
      expect.objectContaining({
        role: ChatMessageRole.ASSISTANT,
        inScope: true,
        similarity: 0.5,
      }),
    );
  });

  it('persists a graceful unavailable assistant reply when AI is down', async () => {
    gateway.chat.mockResolvedValue(null);

    const result = await service.sendMessage(
      learnerId,
      courseId,
      'Noi dung bai hoc?',
    );

    expect(result.isAiAvailable).toBe(false);
    expect(result.reply.content).toContain('khong kha dung');
    expect(messagesRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: ChatMessageRole.ASSISTANT,
        inScope: null,
        citations: [],
      }),
    );
  });

  it('rejects learners who are not enrolled', async () => {
    enrollmentsRepository.findOne.mockResolvedValue(null);

    await expect(
      service.sendMessage(learnerId, courseId, 'Noi dung?'),
    ).rejects.toEqual(
      new ForbiddenException('Bạn cần đăng ký khóa học để dùng chatbot'),
    );
  });

  it('does not expose unpublished courses', async () => {
    coursesRepository.findOne.mockResolvedValue({
      ...course,
      status: CourseStatus.DRAFT,
    });

    await expect(
      service.sendMessage(learnerId, courseId, 'Noi dung?'),
    ).rejects.toEqual(new NotFoundException('Course not found'));
  });
});
