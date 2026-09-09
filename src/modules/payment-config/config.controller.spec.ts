import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';
import { PaymentConfigAuditResponse } from './dto/config.dto';

describe('ConfigController', () => {
  let controller: ConfigController;
  let service: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    service = {
      getActiveConfig: jest.fn(),
      updateConfig: jest.fn(),
      listAudits: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [ConfigController],
      providers: [{ provide: ConfigService, useValue: service }, Reflector],
    }).compile();

    controller = moduleRef.get(ConfigController);
  });

  it('uses controller-level auth and role guards', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ConfigController,
    ) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('requires Admin role at controller level', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ConfigController)).toEqual([
      UserRole.ADMIN,
    ]);
  });

  it('gets active config', async () => {
    const response = {
      id: 'config-id',
    } as Awaited<ReturnType<ConfigService['getActiveConfig']>>;
    service.getActiveConfig.mockResolvedValue(response);

    await expect(controller.getConfig()).resolves.toBe(response);
  });

  it('updates config with current admin id', async () => {
    const dto = {
      platformFeePercent: 15,
      currency: 'VND' as const,
      allowedPrices: [0, 99000],
      freeCourseLimit: 3,
      minimumWithdrawalAmount: 100000,
    };
    const response = {
      id: 'config-id',
    } as Awaited<ReturnType<ConfigService['updateConfig']>>;
    service.updateConfig.mockResolvedValue(response);

    await expect(controller.updateConfig('admin-id', dto)).resolves.toBe(
      response,
    );
    expect(service.updateConfig.mock.calls[0]).toEqual(['admin-id', dto]);
  });

  it('lists audits', async () => {
    const query = { page: 1, limit: 10 };
    const response = {
      items: [] as PaymentConfigAuditResponse[],
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 1,
    };
    service.listAudits.mockResolvedValue(response);

    await expect(controller.listAudits(query)).resolves.toBe(response);
  });
});
