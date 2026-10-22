import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { ConfigService } from './config.service';
import { PaymentConfigAuditResponse } from './dto/config.dto';
import { InstructorBalanceService } from './instructor-balance.service';
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
  let instructorBalanceService: jest.Mocked<InstructorBalanceService>;
  let paymentsService: jest.Mocked<PaymentsService>;
  const transactionId = '33333333-3333-4333-8333-333333333333';

  beforeEach(async () => {
    configService = {
      getActiveConfig: jest.fn(),
      updateConfig: jest.fn(),
      listAudits: jest.fn(),
      getCoursePricingReference: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;
    paymentsService = {
      listLearnerTransactions: jest.fn(),
      getOwnedTransaction: jest.fn(),
      cancelOwnedTransaction: jest.fn(),
      listAdminTransactions: jest.fn(),
      getAdminTransactionDetail: jest.fn(),
      listAdminProviderEvents: jest.fn(),
      getAdminProviderEventDetail: jest.fn(),
    } as unknown as jest.Mocked<PaymentsService>;
    instructorBalanceService = {
      getSummary: jest.fn(),
      listHistory: jest.fn(),
      getRevenueReport: jest.fn(),
    } as unknown as jest.Mocked<InstructorBalanceService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: ConfigService, useValue: configService },
        { provide: PaymentsService, useValue: paymentsService },
        {
          provide: InstructorBalanceService,
          useValue: instructorBalanceService,
        },
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
    expect(getMethodRoles('listAdminTransactions')).toEqual([UserRole.ADMIN]);
    expect(getMethodRoles('getAdminTransactionDetail')).toEqual([
      UserRole.ADMIN,
    ]);
    expect(getMethodRoles('listAdminProviderEvents')).toEqual([UserRole.ADMIN]);
    expect(getMethodRoles('getAdminProviderEventDetail')).toEqual([
      UserRole.ADMIN,
    ]);
  });

  it('requires Instructor role for course pricing', () => {
    expect(getMethodRoles('getCoursePricing')).toEqual([UserRole.INSTRUCTOR]);
    expect(getMethodRoles('getInstructorRevenueReport')).toEqual([
      UserRole.INSTRUCTOR,
    ]);
  });

  it('requires Learner role for payment transaction endpoints', () => {
    expect(getMethodRoles('listLearnerTransactions')).toEqual([
      UserRole.LEARNER,
    ]);
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
      earningHoldDays: 7,
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

  it('lists admin payment transactions', async () => {
    const query = { page: 1, limit: 10 };
    const response = {
      items: [],
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 1,
    };
    paymentsService.listAdminTransactions.mockResolvedValue(response);

    await expect(controller.listAdminTransactions(query)).resolves.toBe(
      response,
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(paymentsService.listAdminTransactions).toHaveBeenCalledWith(query);
    void transactionId;
  });

  it('lists learner payment transactions for current learner', async () => {
    const learnerId = 'learner-id';
    const query = { page: 1, limit: 10 };
    const response = {
      items: [],
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 0,
    };
    paymentsService.listLearnerTransactions.mockResolvedValue(response);

    await expect(
      controller.listLearnerTransactions(learnerId, query),
    ).resolves.toBe(response);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(paymentsService.listLearnerTransactions).toHaveBeenCalledWith(
      learnerId,
      query,
    );
  });

  it('gets admin payment transaction detail', async () => {
    const response = { id: transactionId };
    paymentsService.getAdminTransactionDetail.mockResolvedValue(response);

    await expect(
      controller.getAdminTransactionDetail(transactionId),
    ).resolves.toBe(response);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(paymentsService.getAdminTransactionDetail).toHaveBeenCalledWith(
      transactionId,
    );
  });

  it('lists admin payment provider events', async () => {
    const query = { page: 1, limit: 10 };
    const response = {
      items: [],
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 1,
    };
    paymentsService.listAdminProviderEvents.mockResolvedValue(response);

    await expect(controller.listAdminProviderEvents(query)).resolves.toBe(
      response,
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(paymentsService.listAdminProviderEvents).toHaveBeenCalledWith(query);
  });

  it('gets admin payment provider event detail', async () => {
    const response = { id: 'event-1' };
    paymentsService.getAdminProviderEventDetail.mockResolvedValue(response);

    await expect(
      controller.getAdminProviderEventDetail('event-1'),
    ).resolves.toBe(response);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(paymentsService.getAdminProviderEventDetail).toHaveBeenCalledWith(
      'event-1',
    );
  });
});
