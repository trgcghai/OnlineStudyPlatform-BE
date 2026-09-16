import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { AiChatController } from './ai-chat.controller';
import { AiChatGatewayService } from './ai-chat-gateway.service';
import { AiChatService } from './ai-chat.service';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatSession } from './entities/chat-session.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Course,
      Lesson,
      Enrollment,
      ChatSession,
      ChatMessage,
    ]),
  ],
  controllers: [AiChatController],
  providers: [AiChatService, AiChatGatewayService],
})
export class AiChatModule {}
