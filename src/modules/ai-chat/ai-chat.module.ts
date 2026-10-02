import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiClientModule } from '../ai-client/ai-client.module';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { AiChatController } from './ai-chat.controller';
import { AiChatClient } from './ai-chat.client';
import { AiChatService } from './ai-chat.service';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatSession } from './entities/chat-session.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Course, Enrollment, ChatSession, ChatMessage]),
    AiClientModule,
  ],
  controllers: [AiChatController],
  providers: [AiChatService, AiChatClient],
})
export class AiChatModule {}
