import { Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DataSource, LessThanOrEqual, Repository } from 'typeorm';
import {
  PaymentAuditActorType,
  PaymentAuditLog,
} from './entities/payment-audit.entity';
import {
  PaymentStatus,
  PaymentTransaction,
} from './entities/payment-transaction.entity';
import { PaymentTransactionCleanupService } from './payment-transaction-cleanup.service';
import { Order } from '../orders/entities/order.entity';

type CronMethod = (...args: unknown[]) => unknown;

describe('PaymentTransactionCleanupService', () => {
  let service: PaymentTransactionCleanupService;
  let transactionsRepository: {
    find: jest.Mock;
  };
  let dataSource: {
    transaction: jest.Mock;
  };
  let transactionManager: {
    getRepository: jest.Mock;
  };
  let transactionalTransactionsRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let transactionalAuditsRepository: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let transactionalOrdersRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let loggerErrorSpy: jest.SpiedFunction<Logger['error']>;

  const now = new Date('2026-09-12T10:00:00.000Z');

  const makeTransaction = (
    overrides: Partial<Omit<PaymentTransaction, 'course' | 'learner'>> = {},
  ): PaymentTransaction =>
    ({
      id: '33333333-3333-4333-8333-333333333333',
      learnerId: '11111111-1111-4111-8111-111111111111',
      learner: {} as never,
      courseId: '22222222-2222-4222-8222-222222222222',
      course: {} as never,
      amount: 99000,
      currency: 'VND',
      status: PaymentStatus.PENDING,
      paymentCode: 'KLTN20260912100000ABC123',
      provider: 'sepay',
      providerTransactionId: null,
      providerGateway: null,
      providerReferenceCode: null,
      expiresAt: new Date('2026-09-12T09:55:00.000Z'),
      paidAt: null,
      createdAt: new Date('2026-09-12T09:20:00.000Z'),
      updatedAt: new Date('2026-09-12T09:20:00.000Z'),
      ...overrides,
    }) as PaymentTransaction;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    transactionsRepository = {
      find: jest.fn(),
    };
    transactionalTransactionsRepository = {
      findOne: jest.fn(),
      save: jest.fn((input: PaymentTransaction) => Promise.resolve(input)),
    };
    transactionalAuditsRepository = {
      create: jest.fn((input: Partial<PaymentAuditLog>) => input),
      save: jest.fn(),
    };
    transactionalOrdersRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    transactionManager = {
      getRepository: jest.fn((entity) => {
        if (entity === PaymentTransaction) {
          return transactionalTransactionsRepository;
        }
        if (entity === PaymentAuditLog) {
          return transactionalAuditsRepository;
        }
        if (entity === Order) {
          return transactionalOrdersRepository;
        }
        throw new Error('Unexpected repository');
      }),
    };
    dataSource = {
      transaction: jest.fn(
        (callback: (manager: typeof transactionManager) => unknown) =>
          callback(transactionManager),
      ),
    };

    service = new PaymentTransactionCleanupService(
      transactionsRepository as unknown as Repository<PaymentTransaction>,
      dataSource as unknown as DataSource,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is scheduled every 10 minutes', () => {
    const runCleanup = Object.getOwnPropertyDescriptor(
      PaymentTransactionCleanupService.prototype,
      'runCleanup',
    )?.value as CronMethod;

    expect(Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', runCleanup)).toEqual({
      cronTime: CronExpression.EVERY_10_MINUTES,
    });
  });

  it('selects overdue pending transactions in oldest-first batches', async () => {
    transactionsRepository.find.mockResolvedValue([]);

    await service.runCleanup(now);

    expect(transactionsRepository.find).toHaveBeenCalledWith({
      where: {
        status: PaymentStatus.PENDING,
        expiresAt: LessThanOrEqual(now),
      },
      order: { expiresAt: 'ASC' },
      take: 100,
    });
  });

  it('expires an overdue pending transaction and writes an audit row', async () => {
    const candidate = makeTransaction();
    const locked = makeTransaction();
    transactionsRepository.find.mockResolvedValue([candidate]);
    transactionalTransactionsRepository.findOne.mockResolvedValue(locked);

    await service.runCleanup(now);

    expect(transactionalTransactionsRepository.findOne).toHaveBeenCalledWith({
      where: { id: candidate.id },
      lock: { mode: 'pessimistic_write' },
    });
    expect(transactionalTransactionsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaymentStatus.EXPIRED }),
    );
    expect(transactionalAuditsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: locked.id,
        actorType: PaymentAuditActorType.SYSTEM,
        actorId: null,
        fromStatus: PaymentStatus.PENDING,
        toStatus: PaymentStatus.EXPIRED,
        amount: locked.amount,
        paymentCode: locked.paymentCode,
        providerTransactionId: null,
        reason: 'Payment transaction expired by scheduled cleanup',
      }),
    );
  });

  it('skips a candidate that no longer exists after reload', async () => {
    transactionsRepository.find.mockResolvedValue([makeTransaction()]);
    transactionalTransactionsRepository.findOne.mockResolvedValue(null);

    await service.runCleanup(now);

    expect(transactionalTransactionsRepository.save).not.toHaveBeenCalled();
    expect(transactionalAuditsRepository.save).not.toHaveBeenCalled();
  });

  it('skips a candidate that is no longer pending after reload', async () => {
    transactionsRepository.find.mockResolvedValue([makeTransaction()]);
    transactionalTransactionsRepository.findOne.mockResolvedValue(
      makeTransaction({ status: PaymentStatus.PAID }),
    );

    await service.runCleanup(now);

    expect(transactionalTransactionsRepository.save).not.toHaveBeenCalled();
    expect(transactionalAuditsRepository.save).not.toHaveBeenCalled();
  });

  it('skips a candidate that is no longer expired after reload', async () => {
    transactionsRepository.find.mockResolvedValue([makeTransaction()]);
    transactionalTransactionsRepository.findOne.mockResolvedValue(
      makeTransaction({ expiresAt: new Date('2026-09-12T10:05:00.000Z') }),
    );

    await service.runCleanup(now);

    expect(transactionalTransactionsRepository.save).not.toHaveBeenCalled();
    expect(transactionalAuditsRepository.save).not.toHaveBeenCalled();
  });

  it('logs and continues when one candidate fails', async () => {
    const first = makeTransaction({ id: 'first-transaction-id' });
    const second = makeTransaction({ id: 'second-transaction-id' });
    transactionsRepository.find.mockResolvedValue([first, second]);
    dataSource.transaction
      .mockRejectedValueOnce(new Error('row failed'))
      .mockImplementationOnce(
        (callback: (manager: typeof transactionManager) => unknown) =>
          callback(transactionManager),
      );
    transactionalTransactionsRepository.findOne.mockResolvedValue(second);

    await service.runCleanup(now);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to expire payment transaction first-transaction-id',
      expect.any(String),
    );
    expect(transactionalTransactionsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: second.id, status: PaymentStatus.EXPIRED }),
    );
  });
});
