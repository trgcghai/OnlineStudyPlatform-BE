import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

const learnerId = '11111111-1111-4111-8111-111111111111';
const courseId = '33333333-3333-4333-8333-333333333333';

describe('CartController', () => {
  let controller: CartController;
  let service: {
    listCart: jest.Mock;
    addItem: jest.Mock;
    removeItem: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      listCart: jest.fn(),
      addItem: jest.fn(),
      removeItem: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CartController],
      providers: [{ provide: CartService, useValue: service }],
    }).compile();

    controller = module.get(CartController);
  });

  it('lists the current learner cart', async () => {
    const query = { page: 2, limit: 5 };
    service.listCart.mockReturnValue({ items: [] });

    await controller.listCart(learnerId, query);

    expect(service.listCart).toHaveBeenCalledWith(learnerId, query);
  });

  it('adds an item for the current learner', async () => {
    service.addItem.mockReturnValue({ courseId });

    await controller.addItem(learnerId, { courseId });

    expect(service.addItem).toHaveBeenCalledWith(learnerId, courseId);
  });

  it('removes an item for the current learner', async () => {
    service.removeItem.mockResolvedValue(undefined);

    await controller.removeItem(learnerId, courseId);

    expect(service.removeItem).toHaveBeenCalledWith(learnerId, courseId);
  });

  it('uses 204 for remove', () => {
    const descriptor = Reflect.getMetadata(
      '__httpCode__',
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CartController.prototype.removeItem,
    );
    expect(descriptor).toBe(HttpStatus.NO_CONTENT);
  });
});
