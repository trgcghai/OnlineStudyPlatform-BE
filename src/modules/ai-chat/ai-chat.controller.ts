import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { AiChatService } from './ai-chat.service';
import { CreateChatMessageDto } from './dto/ai-chat.dto';

@Controller('learning/courses/:courseId/chat')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.LEARNER)
export class AiChatController {
  constructor(private readonly chatService: AiChatService) {}

  @Get()
  getSession(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser('id') learnerId: string,
  ) {
    return this.chatService.getSession(learnerId, courseId);
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  sendMessage(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser('id') learnerId: string,
    @Body() dto: CreateChatMessageDto,
  ) {
    return this.chatService.sendMessage(learnerId, courseId, dto.question);
  }
}
