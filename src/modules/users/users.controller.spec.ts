import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/user.dto';

describe('UsersController', () => {
  let controller: UsersController;
  let service: { create: jest.Mock };

  beforeEach(async () => {
    service = { create: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates create to the service', async () => {
    const dto: CreateUserDto = {
      name: 'Nguyen Van A',
      email: 'a@example.com',
      password: 'abcd1234!',
    };
    await controller.create(dto);
    expect(service.create).toHaveBeenCalledWith(dto);
  });
});
