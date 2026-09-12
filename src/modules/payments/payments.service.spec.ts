import {
  BadRequestException,
  ConflictException,
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
import { NotificationsService } from '../notifications/notifications.service';
import { SE_PAY_TRANSFER_IN, SePayWebhookPayload } from './dto/payment.dto';
import {
  PaymentAuditActorType,
  PaymentAuditLog,
} from './entities/payment-audit.entity';
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
  };
  let auditsRepository: { create: jest.Mock; save: jest.Mock };
  let coursesRepository: { findOne: jest.Mock };
  let enrollmentsRepository: {
    findAll: never;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let notificationsService: { createDirectNotification: jest.Mock };
  let configService: {
    get: jest.Mock;
    getOrThrow: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };

  const learnerId = '11111111-1111-4111-8111-111111111111';
  const courseId = '22222222-2222-4222-8222-222222222222';
  const transactionId = '33333333-3333-4333-8333-333333333333';
  const instructorId = '44444444-4444-4444-8444-444444444444';
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  const paymentCode = 'KLTN20260910120000ABC123';

  const makeCourse = (overrides: Partial<Course> = {}): Course => ({
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
  });

  const makeTransaction = (
    overrides: Partial<PaymentTransaction> = {},
  ): PaymentTransaction => ({
    id: transactionId,
    learnerId,
    courseId,
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
    ...overrides,
  });

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

  beforeEach(() => {
    transactionsRepository = {
      create: jest.fn((input: Partial<PaymentTransaction>) => input),
      save: jest.fn((input: Partial<PaymentTransaction>) =>
        Promise.resolve(makeTransaction(input)),
      ),
      findOne: jest.fn(),
      exists: jest.fn(),
    };
    auditsRepository = {
      create: jest.fn((input: Partial<PaymentAuditLog>) => input),
      save: jest.fn(),
    };
    coursesRepository = { findOne: jest.fn() };
    enrollmentsRepository = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((input: Partial<Enrollment>) => input),
      save: jest.fn((input: Partial<Enrollment>) => Promise.resolve(input)),
    };
    notificationsService = { createDirectNotification: jest.fn() };
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
    dataSource = {
      transaction: jest.fn(),
    };

    paymentsService = new PaymentsService(
      transactionsRepository as unknown as Repository<PaymentTransaction>,
      auditsRepository as unknown as Repository<PaymentAuditLog>,
      coursesRepository as unknown as Repository<Course>,
      enrollmentsRepository as unknown as Repository<Enrollment>,
      notificationsService as unknown as NotificationsService,
      configService as unknown as ConfigService,
      dataSource as unknown as DataSource,
    );
  });

  describe('createCheckout', () => {
    it('creates a pending transaction for a published paid course', async () => {
      coursesRepository.findOne.mockResolvedValue(makeCourse());
      enrollmentsRepository.findOne.mockResolvedValue(null);
      transactionsRepository.findOne.mockResolvedValue(null);
      transactionsRepository.exists.mockResolvedValue(false);

      const result = await paymentsService.createCheckout(learnerId, courseId);

      expect(coursesRepository.findOne).toHaveBeenCalledWith({
        where: { id: courseId },
      });
      expect(enrollmentsRepository.findOne).toHaveBeenCalledWith({
        where: { learnerId, courseId },
      });
      expect(transactionsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          learnerId,
          courseId,
          amount: 99000,
          currency: 'VND',
          status: PaymentStatus.PENDING,
          provider: 'sepay',
        }),
      );
      expect(transactionsRepository.exists).toHaveBeenCalled();
      expect(auditsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId,
          actorType: PaymentAuditActorType.SYSTEM,
          toStatus: PaymentStatus.PENDING,
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: transactionId,
          learnerId,
          courseId,
          amount: 99000,
          status: PaymentStatus.PENDING,
          bankAccount: '123456789',
          bankHolder: 'NGUYEN VAN A',
          bankCode: 'VCB',
        }),
      );
      expect(result.paymentCode).toMatch(/^KLTN\d{14}[A-Z0-9]{6}$/);
      expect(result.qrImageUrl).toContain('https://vietqr.app/img?');
      expect(result.qrImageUrl).toContain(`acc=123456789`);
      expect(result.qrImageUrl).toContain(`bank=VCB`);
      expect(result.qrImageUrl).toContain(`amount=99000`);
      expect(result.qrImageUrl).toMatch(/des=SEVQR\+KLTN\d{14}[A-Z0-9]{6}$/);
    });

    it('generates a payment code with the KLTN prefix shape', async () => {
      coursesRepository.findOne.mockResolvedValue(makeCourse());
      enrollmentsRepository.findOne.mockResolvedValue(null);
      transactionsRepository.findOne.mockResolvedValue(null);
      transactionsRepository.exists.mockResolvedValue(false);

      await paymentsService.createCheckout(learnerId, courseId);

      const created = transactionsRepository.create.mock.calls[0][0];
      expect((created as { paymentCode: string }).paymentCode).toMatch(
        /^KLTN\d{14}[A-Z0-9]{6}$/,
      );
    });

    it('throws NotFoundException when the course does not exist', async () => {
      coursesRepository.findOne.mockResolvedValue(null);

      await expect(
        paymentsService.createCheckout(learnerId, courseId),
      ).rejects.toEqual(new NotFoundException('Course not found'));
      expect(transactionsRepository.create).not.toHaveBeenCalled();
    });

    it.each([CourseStatus.DRAFT, CourseStatus.PENDING, CourseStatus.REJECTED])(
      'rejects checkout for %s courses',
      async (status) => {
        coursesRepository.findOne.mockResolvedValue(makeCourse({ status }));

        await expect(
          paymentsService.createCheckout(learnerId, courseId),
        ).rejects.toEqual(
          new BadRequestException(
            'Chỉ có thể thanh toán cho khóa học đã xuất bản',
          ),
        );
        expect(transactionsRepository.create).not.toHaveBeenCalled();
      },
    );

    it('rejects checkout for a free course', async () => {
      coursesRepository.findOne.mockResolvedValue(makeCourse({ price: 0 }));

      await expect(
        paymentsService.createCheckout(learnerId, courseId),
      ).rejects.toEqual(
        new BadRequestException('Khóa học miễn phí không cần thanh toán'),
      );
    });

    it('rejects checkout when the learner is already enrolled', async () => {
      coursesRepository.findOne.mockResolvedValue(makeCourse());
      enrollmentsRepository.findOne.mockResolvedValue({ id: 'e1' });

      await expect(
        paymentsService.createCheckout(learnerId, courseId),
      ).rejects.toEqual(new ConflictException('Bạn đã đăng ký khóa học này'));
      expect(transactionsRepository.create).not.toHaveBeenCalled();
    });

    it('reuses an existing pending non-expired transaction', async () => {
      coursesRepository.findOne.mockResolvedValue(makeCourse());
      enrollmentsRepository.findOne.mockResolvedValue(null);
      transactionsRepository.findOne.mockResolvedValue(makeTransaction());

      const result = await paymentsService.createCheckout(learnerId, courseId);

      expect(transactionsRepository.create).not.toHaveBeenCalled();
      expect(result.id).toBe(transactionId);
      expect(result.status).toBe(PaymentStatus.PENDING);
    });

    it('expires the stale pending transaction and creates a new one', async () => {
      coursesRepository.findOne.mockResolvedValue(makeCourse());
      enrollmentsRepository.findOne.mockResolvedValue(null);
      transactionsRepository.findOne.mockResolvedValue(
        makeTransaction({ expiresAt: new Date('2026-09-01T00:00:00.000Z') }),
      );
      transactionsRepository.exists.mockResolvedValue(false);

      await paymentsService.createCheckout(learnerId, courseId);

      expect(auditsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          fromStatus: PaymentStatus.PENDING,
          toStatus: PaymentStatus.EXPIRED,
          reason: 'Transaction expired without payment',
        }),
      );
      expect(transactionsRepository.create).toHaveBeenCalled();
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
          return null;
        }),
      };
      dataSource.transaction.mockImplementation(
        (callback: (m: typeof manager) => Promise<boolean>) =>
          callback(manager),
      );

      return { txSave, enrollmentRepo, txFindOne };
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
      expect(
        notificationsService.createDirectNotification,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: learnerId,
          title: 'Thanh toán thành công',
          actionUrl: `/learner/courses/${courseId}/learn`,
        }),
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
      expect(notificationsService.createDirectNotification).toHaveBeenCalled();
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
      expect(enrollmentRepo.create).not.toHaveBeenCalled();
      expect(enrollmentRepo.save).not.toHaveBeenCalled();
      expect(
        notificationsService.createDirectNotification,
      ).not.toHaveBeenCalled();
    });

    it('ignores outbound transfers', async () => {
      await paymentsService.processSePayWebhook(
        makeSePayPayload({ transferType: 'out' }),
      );

      expect(transactionsRepository.findOne).not.toHaveBeenCalled();
      expect(
        notificationsService.createDirectNotification,
      ).not.toHaveBeenCalled();
    });

    it('ignores repeated webhooks for the same provider transaction', async () => {
      transactionsRepository.findOne.mockResolvedValueOnce(
        makeTransaction({ providerTransactionId: '123456' }),
      );

      await paymentsService.processSePayWebhook(makeSePayPayload());

      expect(transactionsRepository.save).not.toHaveBeenCalled();
      expect(
        notificationsService.createDirectNotification,
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
        notificationsService.createDirectNotification,
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
        notificationsService.createDirectNotification,
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
        notificationsService.createDirectNotification,
      ).not.toHaveBeenCalled();
    });

    it('ignores webhooks with an unknown payment code', async () => {
      transactionsRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      await paymentsService.processSePayWebhook(makeSePayPayload());

      expect(transactionsRepository.save).not.toHaveBeenCalled();
      expect(
        notificationsService.createDirectNotification,
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
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(enrollmentsRepository.findAll).not.toHaveBeenCalled();
      expect(
        notificationsService.createDirectNotification,
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
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(enrollmentsRepository.findAll).not.toHaveBeenCalled();
      expect(
        notificationsService.createDirectNotification,
      ).not.toHaveBeenCalled();
    });

    it('does not confirm an already-processed non-pending transaction', async () => {
      transactionsRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTransaction({ status: PaymentStatus.PAID }));

      await paymentsService.processSePayWebhook(makeSePayPayload());

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(
        notificationsService.createDirectNotification,
      ).not.toHaveBeenCalled();
    });
  });
});
