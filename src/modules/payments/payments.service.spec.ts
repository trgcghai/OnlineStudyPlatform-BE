import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import {
  Course,
  CourseLearningOrder,
  CourseStatus,
} from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { NotificationsQueueService } from '../notifications/notifications-queue.service';
import { SE_PAY_TRANSFER_IN, SePayWebhookPayload } from './dto/payment.dto';
import {
  PaymentAuditActorType,
  PaymentAuditLog,
} from './entities/payment-audit.entity';
import {
  PaymentProviderEvent,
  PaymentProviderEventResult,
} from './entities/payment-provider-event.entity';
import {
  PaymentStatus,
  PaymentTransaction,
} from './entities/payment-transaction.entity';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let paymentsService: PaymentsService;
  let transactionsRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    exists: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let auditsRepository: { create: jest.Mock; save: jest.Mock; find: jest.Mock };
  let providerEventsRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let enrollmentsRepository: {
    findAll: never;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let notificationsQueueService: { enqueueCreateNotification: jest.Mock };
  let configService: {
    get: jest.Mock;
    getOrThrow: jest.Mock;
  };
  let paymentConfigService: { getActiveConfig: jest.Mock };
  let instructorBalanceService: { recordEarningCredit: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  const learnerId = '11111111-1111-4111-8111-111111111111';
  const courseId = '22222222-2222-4222-8222-222222222222';
  const transactionId = '33333333-3333-4333-8333-333333333333';
  const instructorId = '44444444-4444-4444-8444-444444444444';
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  const paymentCode = 'KLTN20260910120000ABC123';

  const makeCourse = (overrides: Partial<Course> = {}): Course =>
    ({
      id: courseId,
      title: 'Lap trinh NestJS',
      description: 'Khoa hoc nhap mon NestJS',
      category: 'Backend',
      thumbnail: null,
      status: CourseStatus.PUBLISHED,
      rejectReason: null,
      learningOrder: CourseLearningOrder.FREE,
      price: 99000,
      instructorId,
      instructor: {
        id: instructorId,
        name: 'Nguyen Van A',
        email: 'instructor@example.com',
      } as never,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      ...overrides,
    }) as Course;

  const makeTransaction = (
    overrides: Partial<PaymentTransaction> & {
      courseId?: string;
      course?: Course;
    } = {},
  ): PaymentTransaction =>
    ({
      id: transactionId,
      learnerId,
      orderId: 'order-1',
      amount: 99000,
      currency: 'VND',
      status: PaymentStatus.PENDING,
      paymentCode,
      provider: 'sepay',
      providerTransactionId: null,
      providerGateway: null,
      providerReferenceCode: null,
      expiresAt,
      paidAt: null,
      createdAt: new Date('2026-09-10T12:00:00.000Z'),
      updatedAt: new Date('2026-09-10T12:00:00.000Z'),
      order: {
        id: 'order-1',
        learnerId,
        totalAmount: 99000,
        currency: 'VND',
        status: PaymentStatus.PENDING,
        expiresAt,
        paidAt: null,
        items: [
          {
            id: 'order-item-1',
            orderId: 'order-1',
            courseId,
            instructorId,
            unitPrice: 99000,
            course: makeCourse(),
            instructor: makeCourse().instructor,
          },
        ],
      } as never,
      ...overrides,
    }) as PaymentTransaction;

  const makeSePayPayload = (
    overrides: Partial<SePayWebhookPayload> = {},
  ): SePayWebhookPayload => ({
    id: 123456,
    gateway: 'Vietcombank',
    transactionDate: '2026-09-10 12:05:00',
    accountNumber: '123456789',
    code: paymentCode,
    content: 'Thanh toan khoa hoc',
    transferType: SE_PAY_TRANSFER_IN,
    transferAmount: 99000,
    referenceCode: 'ref-1',
    ...overrides,
  });

  const makeQueryBuilder = <T>(items: T[], total = items.length) => {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([items, total]),
    };

    return qb;
  };

  beforeEach(() => {
    transactionsRepository = {
      create: jest.fn((input: Partial<PaymentTransaction>) => input),
      save: jest.fn((input: Partial<PaymentTransaction>) =>
        Promise.resolve(makeTransaction(input)),
      ),
      findOne: jest.fn(),
      exists: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    auditsRepository = {
      create: jest.fn((input: Partial<PaymentAuditLog>) => input),
      save: jest.fn(),
      find: jest.fn(),
    };
    providerEventsRepository = {
      create: jest.fn((input: Partial<PaymentProviderEvent>) => input),
      save: jest.fn((input: Partial<PaymentProviderEvent>) =>
        Promise.resolve({ id: 'event-1', ...input }),
      ),
      findOne: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    enrollmentsRepository = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((input: Partial<Enrollment>) => input),
      save: jest.fn((input: Partial<Enrollment>) => Promise.resolve(input)),
    };
    notificationsQueueService = {
      enqueueCreateNotification: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: jest.fn((key: string, fallback: unknown) =>
        key === 'SEPAY_PAYMENT_CODE_PREFIX' || key === 'PAYMENT_EXPIRE_MINUTES'
          ? fallback
          : fallback,
      ),
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          SEPAY_BANK_ACCOUNT: '123456789',
          SEPAY_BANK_HOLDER: 'NGUYEN VAN A',
          SEPAY_BANK_CODE: 'VCB',
        };
        return values[key];
      }),
    };
    paymentConfigService = {
      getActiveConfig: jest.fn().mockResolvedValue({
        platformFeePercent: 20,
        currency: 'VND',
        minimumWithdrawalAmount: 1000000,
        earningHoldDays: 7,
      }),
    };
    instructorBalanceService = { recordEarningCredit: jest.fn() };
    dataSource = {
      transaction: jest.fn(),
      getRepository: jest.fn((repo: unknown) => {
        if (repo === Order) {
          return {
            findOne: jest.fn().mockResolvedValue(null),
            save: jest.fn(),
          };
        }
        return null;
      }),
    };

    paymentsService = new PaymentsService(
      transactionsRepository as unknown as Repository<PaymentTransaction>,
      auditsRepository as unknown as Repository<PaymentAuditLog>,
      providerEventsRepository as unknown as Repository<PaymentProviderEvent>,
      enrollmentsRepository as unknown as Repository<Enrollment>,
      notificationsQueueService as unknown as NotificationsQueueService,
      configService as unknown as ConfigService,
      dataSource as unknown as DataSource,
      paymentConfigService as never,
      instructorBalanceService as never,
    );
  });

  describe('listLearnerTransactions', () => {
    it('lists only current learner transactions with status and pagination', async () => {
      const transaction = makeTransaction({
        status: PaymentStatus.PAID,
        paidAt: new Date('2026-09-12T08:00:00.000Z'),
      });
      const qb = makeQueryBuilder([transaction], 12);
      transactionsRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await paymentsService.listLearnerTransactions(learnerId, {
        status: PaymentStatus.PAID,
        page: 2,
        limit: 5,
      });

      expect(transactionsRepository.createQueryBuilder).toHaveBeenCalledWith(
        'transaction',
      );
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'transaction.order',
        'order',
      );
      expect(qb.where).toHaveBeenCalledWith(
        'transaction.learnerId = :learnerId',
        { learnerId },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('transaction.status = :status', {
        status: PaymentStatus.PAID,
      });
      expect(qb.orderBy).toHaveBeenCalledWith('transaction.createdAt', 'DESC');
      expect(qb.skip).toHaveBeenCalledWith(5);
      expect(qb.take).toHaveBeenCalledWith(5);
      expect(result).toEqual({
        items: [
          {
            id: transaction.id,
            courseTitle: 'Lap trinh NestJS',
            amount: transaction.amount,
            status: PaymentStatus.PAID,
            createdAt: transaction.createdAt,
            paidAt: transaction.paidAt,
          },
        ],
        total: 12,
        page: 2,
        limit: 5,
        totalPages: 3,
      });
    });

    it('does not expose payment code, provider fields, learner id, course id, or expiry', async () => {
      const transaction = makeTransaction({});
      const qb = makeQueryBuilder([transaction], 1);
      transactionsRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await paymentsService.listLearnerTransactions(
        learnerId,
        {},
      );
      const item = result.items[0] as Record<string, unknown>;

      expect(Object.keys(item).sort()).toEqual([
        'amount',
        'courseTitle',
        'createdAt',
        'id',
        'paidAt',
        'status',
      ]);
      expect(item.paymentCode).toBeUndefined();
      expect(item.provider).toBeUndefined();
      expect(item.providerTransactionId).toBeUndefined();
      expect(item.learnerId).toBeUndefined();
      expect(item.courseId).toBeUndefined();
      expect(item.expiresAt).toBeUndefined();
    });
  });

  describe('listAdminTransactions', () => {
    it('lists admin payment transactions with filters and pagination', async () => {
      const transaction = makeTransaction({
        status: PaymentStatus.PAID,
        learner: {
          id: learnerId,
          name: 'Learner A',
          email: 'learner@example.com',
        } as never,
      });
      const qb = makeQueryBuilder([transaction], 1);
      transactionsRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await paymentsService.listAdminTransactions({
        status: PaymentStatus.PAID,
        search: paymentCode,
        learnerId,
        courseId,
        amountMin: 50000,
        amountMax: 120000,
        page: 2,
        limit: 5,
      });

      expect(transactionsRepository.createQueryBuilder).toHaveBeenCalledWith(
        'transaction',
      );
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'transaction.learner',
        'learner',
      );
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'transaction.order',
        'order',
      );
      expect(qb.andWhere).toHaveBeenCalledWith('transaction.status = :status', {
        status: PaymentStatus.PAID,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        '"transaction"."learner_id"::text ILIKE :learnerId',
        { learnerId: `%${learnerId}%` },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        '"orderItem"."course_id"::text ILIKE :courseId',
        { courseId: `%${courseId}%` },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'transaction.amount >= :amountMin',
        { amountMin: 50000 },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'transaction.amount <= :amountMax',
        { amountMax: 120000 },
      );
      expect(qb.skip).toHaveBeenCalledWith(5);
      expect(qb.take).toHaveBeenCalledWith(5);
      expect(result).toEqual({
        items: [
          expect.objectContaining({
            id: transactionId,
            paymentCode,
            learner: {
              id: learnerId,
              name: 'Learner A',
              email: 'learner@example.com',
            },
            order: expect.objectContaining({
              items: expect.arrayContaining([
                expect.objectContaining({ courseTitle: 'Lap trinh NestJS' }),
              ]),
            }),
          }),
        ],
        total: 1,
        page: 2,
        limit: 5,
        totalPages: 1,
      });
    });

    it('treats a date-only dateTo filter as the end of that day', async () => {
      const qb = makeQueryBuilder([], 0);
      transactionsRepository.createQueryBuilder.mockReturnValue(qb);

      await paymentsService.listAdminTransactions({
        dateTo: '2026-09-12',
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        '"transaction"."created_at" <= :dateTo',
        { dateTo: new Date('2026-09-12T23:59:59.999Z') },
      );
    });

    it('treats a date-only dateFrom filter as the start of that day', async () => {
      const qb = makeQueryBuilder([], 0);
      transactionsRepository.createQueryBuilder.mockReturnValue(qb);

      await paymentsService.listAdminTransactions({
        dateFrom: '2026-09-12',
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        '"transaction"."created_at" >= :dateFrom',
        { dateFrom: new Date('2026-09-12T00:00:00.000Z') },
      );
    });

    it('uses text matching for partial learner and course ids', async () => {
      const qb = makeQueryBuilder([], 0);
      transactionsRepository.createQueryBuilder.mockReturnValue(qb);

      await paymentsService.listAdminTransactions({
        learnerId: '1111',
        courseId: '2222',
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        '"transaction"."learner_id"::text ILIKE :learnerId',
        { learnerId: '%1111%' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        '"orderItem"."course_id"::text ILIKE :courseId',
        { courseId: '%2222%' },
      );
    });

    it('uses database column names for admin transaction search', async () => {
      const qb = makeQueryBuilder([], 0);
      transactionsRepository.createQueryBuilder.mockReturnValue(qb);

      await paymentsService.listAdminTransactions({ search: paymentCode });

      const searchBracket = qb.andWhere.mock.calls[0][0];
      const subQb = {
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
      };
      searchBracket.whereFactory(subQb);

      expect(subQb.where).toHaveBeenCalledWith(
        '"transaction"."id"::text ILIKE :search',
        { search: `%${paymentCode}%` },
      );
      expect(subQb.orWhere).toHaveBeenCalledWith(
        '"transaction"."payment_code" ILIKE :search',
        { search: `%${paymentCode}%` },
      );
      expect(subQb.orWhere).toHaveBeenCalledWith(
        '"transaction"."provider_transaction_id" ILIKE :search',
        { search: `%${paymentCode}%` },
      );
      expect(subQb.orWhere).toHaveBeenCalledWith(
        '"transaction"."learner_id"::text ILIKE :search',
        { search: `%${paymentCode}%` },
      );
      expect(subQb.orWhere).toHaveBeenCalledWith(
        '"orderItem"."course_id"::text ILIKE :search',
        { search: `%${paymentCode}%` },
      );
    });
  });

  describe('getAdminTransactionDetail', () => {
    it('gets admin transaction detail with audits and provider events', async () => {
      const transaction = makeTransaction({
        learner: {
          id: learnerId,
          name: 'Learner A',
          email: 'learner@example.com',
        } as never,
        course: {
          id: courseId,
          title: 'NestJS Course',
        } as never,
      });
      const auditCreatedAt = new Date('2026-09-10T12:00:00.000Z');
      const eventReceivedAt = new Date('2026-09-10T12:05:00.000Z');
      const eventProcessedAt = new Date('2026-09-10T12:05:01.000Z');
      transactionsRepository.findOne.mockResolvedValue(transaction);
      auditsRepository.find.mockResolvedValue([
        {
          id: 'audit-1',
          fromStatus: null,
          toStatus: PaymentStatus.PENDING,
          actorType: PaymentAuditActorType.SYSTEM,
          actorId: null,
          providerTransactionId: null,
          reason: 'Checkout created',
          createdAt: auditCreatedAt,
        },
      ]);
      providerEventsRepository.find.mockResolvedValue([
        {
          id: 'event-1',
          result: PaymentProviderEventResult.PROCESSED_PAID,
          providerTransactionId: '123456',
          reportedPaymentCode: paymentCode,
          transferAmount: 99000,
          transferType: SE_PAY_TRANSFER_IN,
          gateway: 'Vietcombank',
          receivedAt: eventReceivedAt,
          processedAt: eventProcessedAt,
        },
      ]);

      const result =
        await paymentsService.getAdminTransactionDetail(transactionId);

      expect(transactionsRepository.findOne).toHaveBeenCalledWith({
        where: { id: transactionId },
        relations: {
          learner: true,
          order: { items: { course: true, instructor: true } },
        },
      });
      expect(auditsRepository.find).toHaveBeenCalledWith({
        where: { transactionId },
        order: { createdAt: 'DESC' },
      });
      expect(providerEventsRepository.find).toHaveBeenCalledWith({
        where: { paymentTransactionId: transactionId },
        order: { receivedAt: 'DESC', createdAt: 'DESC' },
      });
      expect(result).toEqual(
        expect.objectContaining({
          id: transactionId,
          learner: {
            id: learnerId,
            name: 'Learner A',
            email: 'learner@example.com',
          },
          order: expect.objectContaining({
            items: expect.arrayContaining([
              expect.objectContaining({ courseId }),
            ]),
          }),
          audits: [
            expect.objectContaining({
              id: 'audit-1',
              reason: 'Checkout created',
              createdAt: auditCreatedAt,
            }),
          ],
          providerEvents: [
            expect.objectContaining({
              id: 'event-1',
              result: PaymentProviderEventResult.PROCESSED_PAID,
              receivedAt: eventReceivedAt,
              processedAt: eventProcessedAt,
            }),
          ],
        }),
      );
    });

    it('throws not found for missing admin transaction detail', async () => {
      transactionsRepository.findOne.mockResolvedValue(null);

      await expect(
        paymentsService.getAdminTransactionDetail(transactionId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listAdminProviderEvents', () => {
    it('lists admin provider events with filters and pagination', async () => {
      const event = {
        id: 'event-1',
        provider: 'sepay',
        providerTransactionId: '123456',
        paymentTransactionId: transactionId,
        reportedPaymentCode: paymentCode,
        transferAmount: 99000,
        transferType: SE_PAY_TRANSFER_IN,
        gateway: 'Vietcombank',
        providerReferenceCode: 'ref-1',
        result: PaymentProviderEventResult.PROCESSED_PAID,
        reason: null,
        receivedAt: new Date('2026-09-10T12:05:00.000Z'),
        processedAt: new Date('2026-09-10T12:05:01.000Z'),
        createdAt: new Date('2026-09-10T12:05:00.000Z'),
        paymentTransaction: makeTransaction({ status: PaymentStatus.PAID }),
      };
      const qb = makeQueryBuilder([event], 1);
      providerEventsRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await paymentsService.listAdminProviderEvents({
        result: PaymentProviderEventResult.PROCESSED_PAID,
        search: paymentCode,
        transferType: SE_PAY_TRANSFER_IN,
        paymentStatus: PaymentStatus.PAID,
        gateway: 'Vietcombank',
        page: 1,
        limit: 10,
      });

      expect(providerEventsRepository.createQueryBuilder).toHaveBeenCalledWith(
        'event',
      );
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'event.paymentTransaction',
        'transaction',
      );
      expect(qb.andWhere).toHaveBeenCalledWith('event.result = :result', {
        result: PaymentProviderEventResult.PROCESSED_PAID,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'event.transfer_type = :transferType',
        { transferType: SE_PAY_TRANSFER_IN },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        '"transaction"."status" = :paymentStatus',
        { paymentStatus: PaymentStatus.PAID },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('event.gateway = :gateway', {
        gateway: 'Vietcombank',
      });
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: 'event-1',
          paymentTransaction: expect.objectContaining({
            id: transactionId,
            status: PaymentStatus.PAID,
          }),
        }),
      );
    });

    it('treats a date-only dateTo filter as the end of that received day', async () => {
      const qb = makeQueryBuilder([], 0);
      providerEventsRepository.createQueryBuilder.mockReturnValue(qb);

      await paymentsService.listAdminProviderEvents({
        dateTo: '2026-09-12',
      });

      expect(qb.andWhere).toHaveBeenCalledWith('event.received_at <= :dateTo', {
        dateTo: new Date('2026-09-12T23:59:59.999Z'),
      });
    });

    it('treats a date-only dateFrom filter as the start of that received day', async () => {
      const qb = makeQueryBuilder([], 0);
      providerEventsRepository.createQueryBuilder.mockReturnValue(qb);

      await paymentsService.listAdminProviderEvents({
        dateFrom: '2026-09-12',
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'event.received_at >= :dateFrom',
        {
          dateFrom: new Date('2026-09-12T00:00:00.000Z'),
        },
      );
    });

    it('uses database column names for admin provider event search', async () => {
      const qb = makeQueryBuilder([], 0);
      providerEventsRepository.createQueryBuilder.mockReturnValue(qb);

      await paymentsService.listAdminProviderEvents({ search: paymentCode });

      const searchBracket = qb.andWhere.mock.calls[0][0];
      const subQb = {
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
      };
      searchBracket.whereFactory(subQb);

      expect(subQb.where).toHaveBeenCalledWith('event.id::text ILIKE :search', {
        search: `%${paymentCode}%`,
      });
      expect(subQb.orWhere).toHaveBeenCalledWith(
        'event.provider_transaction_id ILIKE :search',
        { search: `%${paymentCode}%` },
      );
      expect(subQb.orWhere).toHaveBeenCalledWith(
        'event.reported_payment_code ILIKE :search',
        { search: `%${paymentCode}%` },
      );
      expect(subQb.orWhere).toHaveBeenCalledWith(
        'event.provider_reference_code ILIKE :search',
        { search: `%${paymentCode}%` },
      );
      expect(subQb.orWhere).toHaveBeenCalledWith(
        'event.payment_transaction_id::text ILIKE :search',
        { search: `%${paymentCode}%` },
      );
      expect(subQb.orWhere).toHaveBeenCalledWith(
        '"transaction"."payment_code" ILIKE :search',
        { search: `%${paymentCode}%` },
      );
    });
  });

  describe('getAdminProviderEventDetail', () => {
    it('gets admin provider event detail with linked transaction ids only', async () => {
      providerEventsRepository.findOne.mockResolvedValue({
        id: 'event-1',
        provider: 'sepay',
        providerTransactionId: '123456',
        paymentTransactionId: transactionId,
        reportedPaymentCode: paymentCode,
        transferAmount: 99000,
        transferType: SE_PAY_TRANSFER_IN,
        gateway: 'Vietcombank',
        providerReferenceCode: 'ref-1',
        result: PaymentProviderEventResult.PROCESSED_PAID,
        reason: null,
        receivedAt: new Date('2026-09-10T12:05:00.000Z'),
        processedAt: new Date('2026-09-10T12:05:01.000Z'),
        createdAt: new Date('2026-09-10T12:05:00.000Z'),
        paymentTransaction: makeTransaction({ status: PaymentStatus.PAID }),
      });

      const result =
        await paymentsService.getAdminProviderEventDetail('event-1');

      expect(providerEventsRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        relations: {
          paymentTransaction: {
            order: { items: { course: true, instructor: true } },
          },
        },
      });
      expect(result).toEqual(
        expect.objectContaining({
          id: 'event-1',
          paymentTransaction: {
            id: transactionId,
            paymentCode,
            status: PaymentStatus.PAID,
            orderId: 'order-1',
            order: expect.objectContaining({ itemCount: 1 }),
            learnerId,
            amount: 99000,
            currency: 'VND',
          },
        }),
      );
    });

    it('throws not found for missing admin provider event detail', async () => {
      providerEventsRepository.findOne.mockResolvedValue(null);

      await expect(
        paymentsService.getAdminProviderEventDetail('missing-event'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getOwnedTransaction', () => {
    it('returns the transaction for its owner', async () => {
      transactionsRepository.findOne.mockResolvedValue(makeTransaction());

      const result = await paymentsService.getOwnedTransaction(
        learnerId,
        transactionId,
      );

      expect(result.id).toBe(transactionId);
      expect(result.paymentCode).toBe(paymentCode);
    });

    it('throws NotFoundException for an unknown transaction', async () => {
      transactionsRepository.findOne.mockResolvedValue(null);

      await expect(
        paymentsService.getOwnedTransaction(learnerId, transactionId),
      ).rejects.toEqual(new NotFoundException('Payment transaction not found'));
    });

    it('throws ForbiddenException for a foreign transaction', async () => {
      transactionsRepository.findOne.mockResolvedValue(makeTransaction());

      await expect(
        paymentsService.getOwnedTransaction(
          '99999999-9999-4999-8999-999999999999',
          transactionId,
        ),
      ).rejects.toEqual(
        new ForbiddenException('Bạn không có quyền truy cập giao dịch này'),
      );
    });

    it('lazily expires an overdue pending transaction', async () => {
      transactionsRepository.findOne.mockResolvedValue(
        makeTransaction({ expiresAt: new Date('2026-09-01T00:00:00.000Z') }),
      );

      const result = await paymentsService.getOwnedTransaction(
        learnerId,
        transactionId,
      );

      expect(result.status).toBe(PaymentStatus.EXPIRED);
      expect(auditsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          toStatus: PaymentStatus.EXPIRED,
        }),
      );
    });
  });

  describe('cancelOwnedTransaction', () => {
    it('cancels a pending transaction', async () => {
      transactionsRepository.findOne.mockResolvedValue(makeTransaction());

      const result = await paymentsService.cancelOwnedTransaction(
        learnerId,
        transactionId,
      );

      expect(transactionsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: PaymentStatus.CANCELLED }),
      );
      expect(auditsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: PaymentAuditActorType.LEARNER,
          actorId: learnerId,
          fromStatus: PaymentStatus.PENDING,
          toStatus: PaymentStatus.CANCELLED,
        }),
      );
      expect(result.status).toBe(PaymentStatus.CANCELLED);
    });

    it('rejects cancelling a paid transaction', async () => {
      transactionsRepository.findOne.mockResolvedValue(
        makeTransaction({ status: PaymentStatus.PAID }),
      );

      await expect(
        paymentsService.cancelOwnedTransaction(learnerId, transactionId),
      ).rejects.toEqual(
        new BadRequestException('Chỉ có thể hủy giao dịch đang chờ thanh toán'),
      );
    });

    it('rejects cancelling an expired transaction', async () => {
      transactionsRepository.findOne.mockResolvedValue(
        makeTransaction({ expiresAt: new Date('2026-09-01T00:00:00.000Z') }),
      );

      await expect(
        paymentsService.cancelOwnedTransaction(learnerId, transactionId),
      ).rejects.toEqual(new BadRequestException('Giao dịch đã hết hạn'));
    });
  });

  describe('processSePayWebhook', () => {
    const configureHappyPath = () => {
      transactionsRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTransaction());
      const txSave = jest.fn((input: Partial<PaymentTransaction>) =>
        Promise.resolve(makeTransaction({ ...input, id: transactionId })),
      );
      transactionsRepository.save = txSave;
      const auditRepo = {
        create: jest.fn((input: unknown) => input),
        save: jest.fn(),
      };
      const enrollmentRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((input: Partial<Enrollment>) => input),
        save: jest.fn((input: Partial<Enrollment>) =>
          Promise.resolve({ ...input, id: 'e1' }),
        ),
      };
      const orderRepo = {
        findOne: jest.fn().mockResolvedValue(makeTransaction().order),
        save: jest.fn(),
      };
      const orderItemRepo = {
        find: jest.fn().mockResolvedValue(makeTransaction().order?.items ?? []),
      };
      const txFindOne = jest
        .fn()
        .mockResolvedValueOnce(makeTransaction())
        .mockResolvedValue(makeTransaction());
      const txRepository = {
        findOne: txFindOne,
        save: txSave,
      };
      const manager = {
        getRepository: jest.fn((repo: unknown) => {
          if (repo === PaymentTransaction) {
            return txRepository;
          }
          if (repo === PaymentAuditLog) return auditRepo;
          if (repo === Enrollment) return enrollmentRepo;
          if (repo === Order) return orderRepo;
          if (repo === OrderItem) return orderItemRepo;
          return null;
        }),
      };
      dataSource.transaction.mockImplementation(
        (callback: (m: typeof manager) => Promise<boolean>) =>
          callback(manager),
      );

      return { txSave, enrollmentRepo, txFindOne, manager };
    };

    it('confirms a pending transaction and creates the enrollment', async () => {
      const { txSave, enrollmentRepo, txFindOne } = configureHappyPath();

      await paymentsService.processSePayWebhook(makeSePayPayload());

      expect(txFindOne).toHaveBeenCalledWith({
        where: { id: transactionId },
        lock: { mode: 'pessimistic_write' },
      });
      expect(txSave).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PaymentStatus.PAID,
          providerTransactionId: '123456',
          providerGateway: 'Vietcombank',
          providerReferenceCode: 'ref-1',
          paidAt: expect.any(Date),
        }),
      );
      expect(enrollmentRepo.create).toHaveBeenCalledWith({
        learnerId,
        courseId,
        progress: '0.00',
        completedAt: null,
      });
      expect(providerEventsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          providerTransactionId: '123456',
          paymentTransactionId: transactionId,
          reportedPaymentCode: paymentCode,
          transferAmount: 99000,
          transferType: SE_PAY_TRANSFER_IN,
          gateway: 'Vietcombank',
          providerReferenceCode: 'ref-1',
          result: PaymentProviderEventResult.PROCESSED_PAID,
          reason: null,
          processedAt: expect.any(Date),
        }),
      );
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'direct',
          targetUserId: learnerId,
          title: 'Thanh toán thành công',
          actionUrl: `/learner/courses/${courseId}/learn`,
          triggerKey: `payment-success:${transactionId}`,
          triggerDate: expect.any(String),
        }),
      );
    });

    it('records instructor earning credit when payment is confirmed as paid', async () => {
      const { manager } = configureHappyPath();

      await paymentsService.processSePayWebhook(makeSePayPayload());

      expect(instructorBalanceService.recordEarningCredit).toHaveBeenCalledWith(
        expect.objectContaining({
          manager,
          orderItemId: 'order-item-1',
          grossAmount: 99000,
          platformFeeAmount: 19800,
          netAmount: 79200,
          availableAt: expect.any(Date),
        }),
      );
      const earningInput = instructorBalanceService.recordEarningCredit.mock
        .calls[0][0] as { payment: PaymentTransaction; availableAt: Date };
      expect(earningInput.availableAt.getTime()).toBe(
        earningInput.payment.paidAt!.getTime() + 7 * 24 * 60 * 60 * 1000,
      );
    });

    it('confirms a transaction when the payment code is only present in content', async () => {
      configureHappyPath();

      await paymentsService.processSePayWebhook(
        makeSePayPayload({
          code: null,
          content: `Chuyen khoan ${paymentCode}`,
        }),
      );

      expect(auditsRepository.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ toStatus: PaymentStatus.FAILED }),
      );
      expect(dataSource.transaction).toHaveBeenCalled();
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).toHaveBeenCalled();
    });

    it('keeps payment confirmation successful when notification enqueue fails', async () => {
      configureHappyPath();
      notificationsQueueService.enqueueCreateNotification.mockImplementationOnce(
        () => {
          throw new Error('redis down');
        },
      );

      await paymentsService.processSePayWebhook(makeSePayPayload());

      expect(providerEventsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          result: PaymentProviderEventResult.PROCESSED_PAID,
        }),
      );
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'direct',
          targetUserId: learnerId,
          triggerKey: `payment-success:${transactionId}`,
        }),
      );
    });

    it('marks a pending transaction expired when SePay confirms after expiresAt', async () => {
      const expiredTransaction = makeTransaction({
        expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      });
      transactionsRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(expiredTransaction);

      const txSave = jest.fn((input: Partial<PaymentTransaction>) =>
        Promise.resolve(makeTransaction({ ...input, id: transactionId })),
      );
      const auditRepo = {
        create: jest.fn((input: unknown) => input),
        save: jest.fn(),
      };
      const enrollmentRepo = {
        findOne: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
      };
      const manager = {
        getRepository: jest.fn((repo: unknown) => {
          if (repo === PaymentTransaction) {
            return {
              findOne: jest.fn().mockResolvedValue(expiredTransaction),
              save: txSave,
            };
          }
          if (repo === PaymentAuditLog) return auditRepo;
          if (repo === Enrollment) return enrollmentRepo;
          return null;
        }),
      };
      dataSource.transaction.mockImplementation(
        (callback: (m: typeof manager) => Promise<boolean>) =>
          callback(manager),
      );

      await paymentsService.processSePayWebhook(makeSePayPayload());

      expect(txSave).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PaymentStatus.EXPIRED,
          providerTransactionId: '123456',
          providerGateway: 'Vietcombank',
          providerReferenceCode: 'ref-1',
          paidAt: null,
        }),
      );
      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId,
          actorType: PaymentAuditActorType.SEPAY,
          actorId: null,
          fromStatus: PaymentStatus.PENDING,
          toStatus: PaymentStatus.EXPIRED,
          amount: 99000,
          paymentCode,
          providerTransactionId: '123456',
          reason: 'Payment received after transaction expiry',
        }),
      );
      expect(providerEventsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          providerTransactionId: '123456',
          paymentTransactionId: transactionId,
          reportedPaymentCode: paymentCode,
          result: PaymentProviderEventResult.EXPIRED,
          reason: 'Payment received after transaction expiry',
          processedAt: expect.any(Date),
        }),
      );
      expect(enrollmentRepo.create).not.toHaveBeenCalled();
      expect(enrollmentRepo.save).not.toHaveBeenCalled();
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).not.toHaveBeenCalled();
    });

    it('records outbound transfers as ignored provider events', async () => {
      await paymentsService.processSePayWebhook(
        makeSePayPayload({ transferType: 'out' }),
      );

      expect(providerEventsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'sepay',
          providerTransactionId: '123456',
          paymentTransactionId: null,
          reportedPaymentCode: paymentCode,
          transferAmount: 99000,
          transferType: 'out',
          gateway: 'Vietcombank',
          providerReferenceCode: 'ref-1',
          result: PaymentProviderEventResult.IGNORED_TRANSFER_TYPE,
          reason: 'Ignored non-inbound transfer type: out',
          receivedAt: expect.any(Date),
          processedAt: expect.any(Date),
        }),
      );
      expect(transactionsRepository.findOne).not.toHaveBeenCalled();
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).not.toHaveBeenCalled();
    });

    it('ignores repeated provider events for the same provider transaction id', async () => {
      providerEventsRepository.findOne.mockResolvedValue({
        id: 'event-1',
        providerTransactionId: '123456',
      });

      await paymentsService.processSePayWebhook(makeSePayPayload());

      expect(providerEventsRepository.save).not.toHaveBeenCalled();
      expect(transactionsRepository.findOne).not.toHaveBeenCalled();
      expect(transactionsRepository.save).not.toHaveBeenCalled();
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).not.toHaveBeenCalled();
    });

    it('records a second real transfer for an already-paid payment code as duplicate payment', async () => {
      providerEventsRepository.findOne.mockResolvedValue(null);
      transactionsRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          makeTransaction({
            status: PaymentStatus.PAID,
            providerTransactionId: 'first-provider-tx',
            paidAt: new Date('2026-09-10T12:06:00.000Z'),
          }),
        );

      await paymentsService.processSePayWebhook(
        makeSePayPayload({ id: 789012, referenceCode: 'ref-2' }),
      );

      expect(providerEventsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          providerTransactionId: '789012',
          paymentTransactionId: transactionId,
          reportedPaymentCode: paymentCode,
          transferAmount: 99000,
          result: PaymentProviderEventResult.DUPLICATE_PAYMENT,
          reason:
            'Payment transaction is already paid; manual reconciliation required',
          processedAt: expect.any(Date),
        }),
      );
      expect(transactionsRepository.save).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).not.toHaveBeenCalled();
    });

    it('ignores replay of a late expired webhook by provider transaction id', async () => {
      transactionsRepository.findOne.mockResolvedValueOnce(
        makeTransaction({
          status: PaymentStatus.EXPIRED,
          providerTransactionId: '123456',
          paidAt: null,
        }),
      );

      await paymentsService.processSePayWebhook(makeSePayPayload());

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(transactionsRepository.save).not.toHaveBeenCalled();
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).not.toHaveBeenCalled();
    });

    it('does not create enrollment or notification when locked row is already paid', async () => {
      transactionsRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTransaction());

      const txSave = jest.fn();
      const auditRepo = {
        create: jest.fn((input: unknown) => input),
        save: jest.fn(),
      };
      const enrollmentRepo = {
        findOne: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
      };
      const txFindOne = jest.fn().mockResolvedValue(
        makeTransaction({
          status: PaymentStatus.PAID,
          providerTransactionId: 'other-provider-tx',
          paidAt: new Date('2026-09-10T12:06:00.000Z'),
        }),
      );
      const manager = {
        getRepository: jest.fn((repo: unknown) => {
          if (repo === PaymentTransaction) {
            return { findOne: txFindOne, save: txSave };
          }
          if (repo === PaymentAuditLog) return auditRepo;
          if (repo === Enrollment) return enrollmentRepo;
          return null;
        }),
      };
      dataSource.transaction.mockImplementation(
        (callback: (m: typeof manager) => Promise<boolean>) =>
          callback(manager),
      );

      await paymentsService.processSePayWebhook(makeSePayPayload());

      expect(txFindOne).toHaveBeenCalledWith({
        where: { id: transactionId },
        lock: { mode: 'pessimistic_write' },
      });
      expect(txSave).not.toHaveBeenCalled();
      expect(auditRepo.save).not.toHaveBeenCalled();
      expect(enrollmentRepo.create).not.toHaveBeenCalled();
      expect(enrollmentRepo.save).not.toHaveBeenCalled();
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).not.toHaveBeenCalled();
    });

    it('does not create enrollment or notification when locked row is already expired', async () => {
      transactionsRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTransaction());

      const txSave = jest.fn();
      const auditRepo = {
        create: jest.fn((input: unknown) => input),
        save: jest.fn(),
      };
      const enrollmentRepo = {
        findOne: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
      };
      const txFindOne = jest.fn().mockResolvedValue(
        makeTransaction({
          status: PaymentStatus.EXPIRED,
          providerTransactionId: 'other-provider-tx',
          paidAt: null,
        }),
      );
      const manager = {
        getRepository: jest.fn((repo: unknown) => {
          if (repo === PaymentTransaction) {
            return { findOne: txFindOne, save: txSave };
          }
          if (repo === PaymentAuditLog) return auditRepo;
          if (repo === Enrollment) return enrollmentRepo;
          return null;
        }),
      };
      dataSource.transaction.mockImplementation(
        (callback: (m: typeof manager) => Promise<boolean>) =>
          callback(manager),
      );

      await paymentsService.processSePayWebhook(makeSePayPayload());

      expect(txFindOne).toHaveBeenCalledWith({
        where: { id: transactionId },
        lock: { mode: 'pessimistic_write' },
      });
      expect(txSave).not.toHaveBeenCalled();
      expect(auditRepo.save).not.toHaveBeenCalled();
      expect(enrollmentRepo.create).not.toHaveBeenCalled();
      expect(enrollmentRepo.save).not.toHaveBeenCalled();
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).not.toHaveBeenCalled();
    });

    it('records webhooks with an unknown payment code', async () => {
      providerEventsRepository.findOne.mockResolvedValue(null);
      transactionsRepository.findOne.mockResolvedValueOnce(null);

      await paymentsService.processSePayWebhook(makeSePayPayload());

      expect(providerEventsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          providerTransactionId: '123456',
          paymentTransactionId: null,
          reportedPaymentCode: paymentCode,
          result: PaymentProviderEventResult.UNKNOWN_PAYMENT_CODE,
          reason: `No payment transaction found for payment code ${paymentCode}`,
          processedAt: expect.any(Date),
        }),
      );
      expect(transactionsRepository.save).not.toHaveBeenCalled();
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).not.toHaveBeenCalled();
    });

    it('marks the transaction failed when the transfer amount is too low', async () => {
      transactionsRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTransaction());

      await paymentsService.processSePayWebhook(
        makeSePayPayload({ transferAmount: 50000 }),
      );

      expect(transactionsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PaymentStatus.FAILED,
          providerTransactionId: '123456',
          providerGateway: 'Vietcombank',
          providerReferenceCode: 'ref-1',
          paidAt: null,
        }),
      );
      expect(auditsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: PaymentAuditActorType.SEPAY,
          fromStatus: PaymentStatus.PENDING,
          toStatus: PaymentStatus.FAILED,
          providerTransactionId: '123456',
          reason: 'Payment amount mismatch: expected=99000, received=50000',
        }),
      );
      expect(providerEventsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          providerTransactionId: '123456',
          paymentTransactionId: transactionId,
          reportedPaymentCode: paymentCode,
          result: PaymentProviderEventResult.AMOUNT_MISMATCH,
          reason: 'Payment amount mismatch: expected=99000, received=50000',
          processedAt: expect.any(Date),
        }),
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(enrollmentsRepository.findAll).not.toHaveBeenCalled();
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).not.toHaveBeenCalled();
    });

    it('marks the transaction failed when the transfer amount is too high', async () => {
      transactionsRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTransaction());

      await paymentsService.processSePayWebhook(
        makeSePayPayload({ transferAmount: 120000 }),
      );

      expect(transactionsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PaymentStatus.FAILED,
          providerTransactionId: '123456',
          providerGateway: 'Vietcombank',
          providerReferenceCode: 'ref-1',
          paidAt: null,
        }),
      );
      expect(auditsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: PaymentAuditActorType.SEPAY,
          fromStatus: PaymentStatus.PENDING,
          toStatus: PaymentStatus.FAILED,
          providerTransactionId: '123456',
          reason: 'Payment amount mismatch: expected=99000, received=120000',
        }),
      );
      expect(providerEventsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          providerTransactionId: '123456',
          paymentTransactionId: transactionId,
          reportedPaymentCode: paymentCode,
          result: PaymentProviderEventResult.AMOUNT_MISMATCH,
          reason: 'Payment amount mismatch: expected=99000, received=120000',
          processedAt: expect.any(Date),
        }),
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(enrollmentsRepository.findAll).not.toHaveBeenCalled();
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).not.toHaveBeenCalled();
    });

    it('does not confirm an already-processed non-pending transaction', async () => {
      transactionsRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTransaction({ status: PaymentStatus.PAID }));

      await paymentsService.processSePayWebhook(makeSePayPayload());

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(
        notificationsQueueService.enqueueCreateNotification,
      ).not.toHaveBeenCalled();
    });
  });
});
