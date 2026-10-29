import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { AccessTokenUserValidatorService } from '../../common/services/access-token-user-validator.service';
import { AccessTokenPayload } from '../auth/dto/auth.dto';
import { UserRole } from '../users/entities/user.entity';
import { NotificationQueue } from './entities/notification.entity';
import { NOTIFICATION_CREATED_EVENT } from './notification-queue.constants';

const COURSE_APPROVAL_QUEUE_ROOM = 'queue:course_approval';

interface NotificationSocket {
  handshake: {
    auth?: Record<string, unknown>;
    headers: {
      authorization?: string | string[];
    };
  };
  data: Record<string, unknown>;
  join(room: string): void | Promise<void>;
  disconnect(close?: boolean): void;
}

interface NotificationServer {
  to(room: string): {
    emit(event: string, payload: { notificationId: string }): void;
  };
}

@WebSocketGateway()
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  private server!: NotificationServer;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly accessTokenUserValidator: AccessTokenUserValidatorService,
  ) {}

  async handleConnection(
    @ConnectedSocket() client: NotificationSocket,
  ): Promise<void> {
    try {
      const token = this.extractToken(client);
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(
        token,
        { secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET') },
      );
      const user = await this.accessTokenUserValidator.validate(payload);

      client.data.user = user;
      await client.join(this.getUserRoom(user.id));

      if (user.role === UserRole.ADMIN) {
        await client.join(COURSE_APPROVAL_QUEUE_ROOM);
      }
    } catch (error) {
      this.logger.warn(
        'Rejected notification socket connection',
        error instanceof Error ? error.message : String(error),
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(@ConnectedSocket() client: NotificationSocket): void {
    const user = client.data.user as { id?: string } | undefined;
    const userId = user?.id;
    if (userId) {
      this.logger.debug(`Notification socket disconnected for user ${userId}`);
    }
  }

  emitNotificationCreatedToUser(userId: string, notificationId: string): void {
    this.server.to(this.getUserRoom(userId)).emit(NOTIFICATION_CREATED_EVENT, {
      notificationId,
    });
  }

  emitNotificationCreatedForQueue(
    queue: NotificationQueue,
    notificationId: string,
  ): void {
    switch (queue) {
      case NotificationQueue.COURSE_APPROVAL:
        this.server
          .to(COURSE_APPROVAL_QUEUE_ROOM)
          .emit(NOTIFICATION_CREATED_EVENT, { notificationId });
        break;
      default:
        this.logger.warn(
          `Unsupported notification queue for realtime emit: ${queue as string}`,
        );
    }
  }

  private extractToken(client: NotificationSocket): string {
    const authToken = client.handshake.auth?.token;

    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.trim();
    }

    const authorization = client.handshake.headers.authorization;
    if (typeof authorization === 'string') {
      const match = authorization.match(/^Bearer\s+(.+)$/i);
      const token = match?.[1]?.trim();
      if (token) return token;
    }

    throw new Error('Missing notification socket access token');
  }

  private getUserRoom(userId: string): string {
    return `user:${userId}`;
  }
}
