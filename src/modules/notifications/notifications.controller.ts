import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/dto/auth.dto';
import { ListNotificationsQueryDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('me')
  findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notificationsService.findMine(user, query);
  }

  @Get('me/unread-count')
  countUnread(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.countUnread(user);
  }

  @Patch('me/seen')
  markAllAsSeen(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markAllAsSeen(user);
  }

  @Patch(':id/seen')
  markAsSeen(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markAsSeen(id, user);
  }
}
