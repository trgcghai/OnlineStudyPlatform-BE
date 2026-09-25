import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessTokenUserValidatorService } from '../../common/services/access-token-user-validator.service';
import { UserRole, UserStatus } from '../users/entities/user.entity';
import { NotificationQueue } from './entities/notification.entity';
import { NOTIFICATION_CREATED_EVENT } from './notification-queue.constants';
import { NotificationsGateway } from './notifications.gateway';

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;
  let jwtService: { verifyAsync: jest.Mock };
  let accessTokenUserValidator: { validate: jest.Mock };

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };
    accessTokenUserValidator = { validate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsGateway,
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('access-secret') },
        },
        {
          provide: AccessTokenUserValidatorService,
          useValue: accessTokenUserValidator,
        },
      ],
    }).compile();

    gateway = module.get<NotificationsGateway>(NotificationsGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  it('defines the notification created event contract', () => {
    expect(NOTIFICATION_CREATED_EVENT).toBe('notification.created');
  });

  it('authenticates a valid learner socket and joins the user room', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'learner-1' });
    accessTokenUserValidator.validate.mockResolvedValue({
      id: 'learner-1',
      email: 'learner@example.com',
      role: UserRole.LEARNER,
      status: UserStatus.ACTIVE,
    });
    const socket = createSocket({ token: 'access-token' });

    await gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith('user:learner-1');
    expect(socket.join).not.toHaveBeenCalledWith('queue:course_approval');
    expect(socket.data.user.id).toBe('learner-1');
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('joins admin sockets to the course approval queue room', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'admin-1' });
    accessTokenUserValidator.validate.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
    const socket = createSocket({ token: 'access-token' });

    await gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith('user:admin-1');
    expect(socket.join).toHaveBeenCalledWith('queue:course_approval');
  });

  it('accepts bearer tokens from the authorization header', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'learner-1' });
    accessTokenUserValidator.validate.mockResolvedValue({
      id: 'learner-1',
      email: 'learner@example.com',
      role: UserRole.LEARNER,
      status: UserStatus.ACTIVE,
    });
    const socket = createSocket({ authorization: 'Bearer header-token' });

    await gateway.handleConnection(socket);

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('header-token', {
      secret: 'access-secret',
    });
    expect(socket.join).toHaveBeenCalledWith('user:learner-1');
  });

  it('disconnects sockets without a token', async () => {
    const socket = createSocket();

    await gateway.handleConnection(socket);

    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects sockets with invalid tokens', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid token'));
    const socket = createSocket({ token: 'bad-token' });

    await gateway.handleConnection(socket);

    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it.each([
    ['blacklisted token'],
    ['pending verification user'],
    ['disabled user'],
  ])('disconnects sockets rejected by shared auth validation: %s', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
    accessTokenUserValidator.validate.mockRejectedValue(new Error('forbidden'));
    const socket = createSocket({ token: 'access-token' });

    await gateway.handleConnection(socket);

    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('emits notification.created to a direct user room', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    Object.assign(gateway, { server: { to } });

    gateway.emitNotificationCreatedToUser('user-1', 'notification-1');

    expect(to).toHaveBeenCalledWith('user:user-1');
    expect(emit).toHaveBeenCalledWith(NOTIFICATION_CREATED_EVENT, {
      notificationId: 'notification-1',
    });
  });

  it('emits course approval queue notifications to the explicit queue room', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    Object.assign(gateway, { server: { to } });

    gateway.emitNotificationCreatedForQueue(
      NotificationQueue.COURSE_APPROVAL,
      'notification-1',
    );

    expect(to).toHaveBeenCalledWith('queue:course_approval');
    expect(emit).toHaveBeenCalledWith(NOTIFICATION_CREATED_EVENT, {
      notificationId: 'notification-1',
    });
  });

  it('logs and does not emit unsupported queue values', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    Object.assign(gateway, { server: { to } });
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    gateway.emitNotificationCreatedForQueue(
      'unsupported' as NotificationQueue,
      'notification-1',
    );

    expect(to).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Unsupported notification queue for realtime emit: unsupported',
    );

    warnSpy.mockRestore();
  });

  function createSocket(
    options: { token?: string; authorization?: string } = {},
  ) {
    return {
      handshake: {
        auth: options.token ? { token: options.token } : {},
        headers: options.authorization
          ? { authorization: options.authorization }
          : {},
      },
      data: {},
      join: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
    };
  }
});
