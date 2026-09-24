import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { UserRole } from '../users/entities/user.entity';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: {
    findMine: jest.Mock;
    countUnread: jest.Mock;
    markAsSeen: jest.Mock;
    markAllAsSeen: jest.Mock;
  };

  const user = { id: 'user-id', role: UserRole.INSTRUCTOR };

  beforeEach(() => {
    service = {
      findMine: jest.fn(),
      countUnread: jest.fn(),
      markAsSeen: jest.fn(),
      markAllAsSeen: jest.fn(),
    };
    controller = new NotificationsController(
      service as unknown as NotificationsService,
    );
  });

  it('delegates my notification list with current user and pagination', async () => {
    const query = { page: 2, limit: 20 };

    await controller.findMine(user, query);

    expect(service.findMine).toHaveBeenCalledWith(user, query);
  });

  it('delegates unread count with current user', async () => {
    await controller.countUnread(user);

    expect(service.countUnread).toHaveBeenCalledWith(user);
  });

  it('delegates mark as seen with id and current user', async () => {
    await controller.markAsSeen('notification-id', user);

    expect(service.markAsSeen).toHaveBeenCalledWith('notification-id', user);
  });

  it('delegates mark all as seen with current user', async () => {
    service.markAllAsSeen.mockResolvedValue({ modifiedCount: 3 });

    const result = await controller.markAllAsSeen(user);

    expect(service.markAllAsSeen).toHaveBeenCalledWith(user);
    expect(result).toEqual({ modifiedCount: 3 });
  });
});
