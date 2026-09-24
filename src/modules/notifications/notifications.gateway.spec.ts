import { Test, TestingModule } from '@nestjs/testing';
import { NOTIFICATION_CREATED_EVENT } from './notification-queue.constants';
import { NotificationsGateway } from './notifications.gateway';

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationsGateway],
    }).compile();

    gateway = module.get<NotificationsGateway>(NotificationsGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  it('defines the future notification created event contract', () => {
    expect(NOTIFICATION_CREATED_EVENT).toBe('notification.created');
  });

  it('does not require injected delivery services for T3-02', () => {
    expect(new NotificationsGateway()).toBeInstanceOf(NotificationsGateway);
  });
});
