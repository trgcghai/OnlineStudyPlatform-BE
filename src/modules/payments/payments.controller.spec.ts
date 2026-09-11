import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { ConfigService } from './config.service';
import { PaymentConfigAuditResponse } from './dto/config.dto';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

function getMethodRoles(methodName: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(
    PaymentsController.prototype,
    methodName,
  );
  const method = descriptor?.value as object | undefined;

  return method ? Reflect.getMetadata(ROLES_KEY, method) : undefined;
}

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let configService: jest.Mocked<ConfigService>;
  let paymentsService: jest.Mocked<PaymentsService>;

  beforeEach(async () => {
    configService = {
      getActiveConfig: jest.fn(),
      updateConfig: jest.fn(),
      listAudits: jest.fn(),
      getCoursePricingReference: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;
    paymentsService = {
      createCheckout: jest.fn(),
      getOwnedTransaction: jest.fn(),
      cancelOwnedTransaction: jest.fn(),
    } as unknown as jest.Mocked<PaymentsService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: ConfigService, useValue: configService },
        { provide: PaymentsService, useValue: paymentsService },
        Reflector,
      ],
    }).compile();

    controller = moduleRef.get(PaymentsController);
  });

  it('uses controller-level auth and role guards', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      PaymentsController,
    ) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('requires Admin role for config endpoints', () => {
    expect(getMethodRoles('getConfig')).toEqual([UserRole.ADMIN]);
    expect(getMethodRoles('updateConfig')).toEqual([UserRole.ADMIN]);
    expect(getMethodRoles('listAudits')).toEqual([UserRole.ADMIN]);
  });

  it('requires Instructor role for course pricing', () => {
    expect(getMethodRoles('getCoursePricing')).toEqual([UserRole.INSTRUCTOR]);
  });

  it('requires Learner role for checkout endpoints', () => {
    expect(getMethodRoles('createCheckout')).toEqual([UserRole.LEARNER]);
    expect(getMethodRoles('getTransaction')).toEqual([UserRole.LEARNER]);
    expect(getMethodRoles('cancelTransaction')).toEqual([UserRole.LEARNER]);
  });

  it('does not require one controller-level role', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PaymentsController)).toBeUndefined();
  });

  it('gets course pricing reference', async () => {
    const response = {
      currency: 'VND' as const,
      allowedPrices: [0, 99000],
    };
    configService.getCoursePricingReference.mockResolvedValue(response);

    await expect(controller.getCoursePricing()).resolves.toBe(response);
  });

  it('gets active config', async () => {
    const response = {
      id: 'config-id',
    } as Awaited<ReturnType<ConfigService['getActiveConfig']>>;
    configService.getActiveConfig.mockResolvedValue(response);

    await expect(controller.getConfig()).resolves.toBe(response);
  });

  it('updates config with current admin id', async () => {
    const dto = {
      platformFeePercent: 15,
      currency: 'VND' as const,
      allowedPrices: [0, 99000],
      freeCourseLimit: 3,
      minimumWithdrawalAmount: 1000000,
    };
    const response = {
      id: 'config-id',
    } as Awaited<ReturnType<ConfigService['updateConfig']>>;
    configService.updateConfig.mockResolvedValue(response);

    await expect(
      controller.updateConfig('admin-id', 'admin@example.com', dto),
    ).resolves.toBe(response);
    expect(configService.updateConfig.mock.calls[0]).toEqual([
      'admin-id',
      'admin@example.com',
      dto,
    ]);
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
    configService.listAudits.mockResolvedValue(response);

    await expect(controller.listAudits(query)).resolves.toBe(response);
  });
});
