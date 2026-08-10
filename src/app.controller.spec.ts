import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  const appService = { getHealth: jest.fn() };
  const dataSource = { query: jest.fn() } as unknown as DataSource;

  beforeEach(async () => {
    jest.resetAllMocks();

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: AppService, useValue: appService },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('returns the health payload from the service', async () => {
      const health = {
        status: 'UP',
        components: { application: { status: 'UP' } },
      };
      appService.getHealth.mockResolvedValue(health);

      await expect(appController.getHealth()).resolves.toEqual(health);
      expect(appService.getHealth).toHaveBeenCalled();
    });
  });
});
