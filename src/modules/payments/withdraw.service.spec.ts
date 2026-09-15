import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { InstructorAccount } from '../users/entities/instructor-account.entity';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { ConfigService as PaymentConfigService } from './config.service';
import { WithdrawRequestStatus } from './entities/withdraw-request.entity';
import { WithdrawService } from './withdraw.service';
import { ListAdminWithdrawRequestsQueryDto } from 'src/modules/payments/dto/withdraw.dto';

describe('WithdrawService', () => {
  let service: WithdrawService;
  let withdrawRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let accountRepo: { findOne: jest.Mock };
  let configService: { getActiveConfig: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let instructorBalanceService: {
    getSummary: jest.Mock;
    recordWithdrawDebit: jest.Mock;
  };

  const instructorId = '44444444-4444-4444-8444-444444444444';
  const otherInstructorId = '55555555-5555-4555-8555-555555555555';
  const requestId = '66666666-6666-4666-8666-666666666666';

  const makeUser = (overrides: Partial<User> = {}): User => ({
    id: instructorId,
    name: 'Nguyen Van A',
    email: 'instructor@example.com',
    password: 'hashed-password',
    role: UserRole.INSTRUCTOR,
    status: UserStatus.ACTIVE,
    avatar: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });

  const makeAccount = (
    overrides: Partial<InstructorAccount> = {},
  ): InstructorAccount => ({
    id: '77777777-7777-4777-8777-777777777777',
    instructorId,
    instructor: makeUser(),
    bankName: 'VCB',
    bankAccountNumber: '123456789',
    accountHolderName: 'NGUYEN VAN A',
    bankCode: 'VCB',
    branchName: null,
    phoneNumber: null,
    note: null,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  });

  const makeWithdrawRequest = (overrides: Record<string, unknown> = {}) => ({
    id: requestId,
    instructorId,
    instructor: makeUser(),
    amount: 1500000,
    currency: 'VND',
    status: WithdrawRequestStatus.PENDING,
    requestedAt: new Date('2026-09-13T09:00:00.000Z'),
    note: 'Rut tien khoa hoc',
    cancelReason: null,
    cancelledAt: null,
    rejectReason: null,
    rejectedAt: null,
    processingAt: null,
    processedAt: null,
    payoutReference: null,
    payoutDescription: null,
    createdAt: new Date('2026-09-13T09:00:00.000Z'),
    updatedAt: new Date('2026-09-13T09:00:00.000Z'),
    ...overrides,
  });

  const makeConfig = () => ({
    id: 'config-id',
    platformFeePercent: 20,
    currency: 'VND' as const,
    allowedPrices: [0, 99000],
    freeCourseLimit: 3,
    minimumWithdrawalAmount: 1000000,
    earningHoldDays: 7,
    updatedById: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  const makeQueryBuilder = (items: unknown[], total = items.length) => {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
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
    withdrawRepo = {
      create: jest.fn((input: Record<string, unknown>) => input),
      save: jest.fn((input: Record<string, unknown>) =>
        Promise.resolve(makeWithdrawRequest(input)),
      ),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
    };
    accountRepo = { findOne: jest.fn().mockResolvedValue(makeAccount()) };
    configService = {
      getActiveConfig: jest.fn().mockResolvedValue(makeConfig()),
    };
    dataSource = {
      transaction: jest.fn((callback: (manager: unknown) => Promise<unknown>) =>
        callback({}),
      ),
    };
    instructorBalanceService = {
      getSummary: jest.fn().mockResolvedValue({
        totalBalance: 3000000,
        currentBalance: 3000000,
        withdrawableBalance: 3000000,
        nonWithdrawableBalance: 0,
        totalEarned: 3000000,
        totalWithdrawn: 0,
        currency: 'VND',
      }),
      recordWithdrawDebit: jest.fn(),
    };

    service = new WithdrawService(
      withdrawRepo as unknown as Repository<never>,
      accountRepo as unknown as Repository<InstructorAccount>,
      configService as unknown as PaymentConfigService,
      dataSource as never,
      instructorBalanceService as never,
    );
  });

  describe('create', () => {
    it('creates a pending request with configured currency and backend requestedAt', async () => {
      const before = Date.now();

      const result = await service.create(makeUser(), {
        amount: 1500000,
        note: ' Rut tien khoa hoc ',
      });

      const createdInput = withdrawRepo.create.mock.calls[0][0];
      expect(accountRepo.findOne).toHaveBeenCalledWith({
        where: { instructorId },
      });
      expect(createdInput).toMatchObject({
        instructorId,
        amount: 1500000,
        currency: 'VND',
        status: WithdrawRequestStatus.PENDING,
        note: 'Rut tien khoa hoc',
      });
      expect(createdInput.requestedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(result).toMatchObject({
        instructorId,
        amount: 1500000,
        currency: 'VND',
        status: WithdrawRequestStatus.PENDING,
        processingAt: null,
        processedAt: null,
        payoutReference: null,
        payoutDescription: null,
      });
    });

    it('normalizes blank note to null', async () => {
      await service.create(makeUser(), { amount: 1500000, note: '   ' });

      expect(withdrawRepo.create.mock.calls[0][0]).toMatchObject({
        note: null,
      });
    });

    it('rejects non-instructor callers', async () => {
      await expect(
        service.create(makeUser({ role: UserRole.LEARNER }), {
          amount: 1500000,
        }),
      ).rejects.toEqual(new BadRequestException('User is not an instructor'));
      expect(withdrawRepo.save).not.toHaveBeenCalled();
    });

    it('rejects instructors without payout account configuration', async () => {
      accountRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create(makeUser(), { amount: 1500000 }),
      ).rejects.toEqual(
        new BadRequestException('Instructor payout account is required'),
      );
      expect(withdrawRepo.save).not.toHaveBeenCalled();
    });

    it('rejects amounts below configured minimum withdrawal amount', async () => {
      await expect(
        service.create(makeUser(), { amount: 999999 }),
      ).rejects.toEqual(
        new BadRequestException({
          message: 'Amount is below minimum withdrawal amount',
          details: ['minimumWithdrawalAmount=1000000', 'currency=VND'],
        }),
      );
      expect(withdrawRepo.save).not.toHaveBeenCalled();
    });

    it('rejects amounts above the instructor withdrawable balance', async () => {
      instructorBalanceService.getSummary.mockResolvedValue({
        totalBalance: 2000000,
        currentBalance: 2000000,
        withdrawableBalance: 1200000,
        nonWithdrawableBalance: 800000,
        totalEarned: 2000000,
        totalWithdrawn: 0,
        currency: 'VND',
      });

      await expect(
        service.create(makeUser(), { amount: 1500000 }),
      ).rejects.toEqual(
        new BadRequestException({
          message: 'Amount exceeds withdrawable balance',
          details: ['withdrawableBalance=1200000', 'currency=VND'],
        }),
      );
      expect(instructorBalanceService.getSummary).toHaveBeenCalledWith(
        makeUser(),
      );
      expect(withdrawRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('listMine', () => {
    it('returns only current instructor requests sorted latest first', async () => {
      const requests = [
        makeWithdrawRequest({ requestedAt: new Date('2026-09-13T10:00:00Z') }),
      ];
      const qb = makeQueryBuilder(requests, 1);
      withdrawRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listMine(makeUser(), { page: 2, limit: 5 });

      expect(qb.where).toHaveBeenCalledWith(
        'withdraw.instructorId = :instructorId',
        {
          instructorId,
        },
      );
      expect(qb.orderBy).toHaveBeenCalledWith('withdraw.requestedAt', 'DESC');
      expect(qb.skip).toHaveBeenCalledWith(5);
      expect(qb.take).toHaveBeenCalledWith(5);
      expect(result).toMatchObject({
        total: 1,
        page: 2,
        limit: 5,
        totalPages: 1,
      });
      expect(result.items).toHaveLength(1);
    });

    it('rejects non-instructor callers', async () => {
      await expect(
        service.listMine(makeUser({ role: UserRole.LEARNER }), {
          page: 1,
          limit: 10,
        }),
      ).rejects.toEqual(new BadRequestException('User is not an instructor'));
    });
  });

  describe('listAdmin', () => {
    it('filters by pending status and sorts latest first then amount descending by default', async () => {
      const qb = makeQueryBuilder([makeWithdrawRequest()], 1);
      withdrawRepo.createQueryBuilder.mockReturnValue(qb);

      await service.listAdmin({
        page: 1,
        limit: 10,
        status: WithdrawRequestStatus.PENDING,
      } as ListAdminWithdrawRequestsQueryDto);

      expect(qb.where).toHaveBeenCalledWith('1 = 1');
      expect(qb.andWhere).toHaveBeenCalledWith('withdraw.status = :status', {
        status: WithdrawRequestStatus.PENDING,
      });
      expect(qb.orderBy).toHaveBeenCalledWith('withdraw.requestedAt', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('withdraw.amount', 'DESC');
    });

    it('does not filter status when status is omitted', async () => {
      const qb = makeQueryBuilder([makeWithdrawRequest()], 1);
      withdrawRepo.createQueryBuilder.mockReturnValue(qb);

      await service.listAdmin({
        page: 1,
        limit: 10,
      } as ListAdminWithdrawRequestsQueryDto);

      expect(qb.where).toHaveBeenCalledWith('1 = 1');
      expect(qb.andWhere).not.toHaveBeenCalledWith(
        'withdraw.status = :status',
        expect.any(Object),
      );
    });

    it('filters by instructor email and requested date range', async () => {
      const qb = makeQueryBuilder([makeWithdrawRequest()], 1);
      withdrawRepo.createQueryBuilder.mockReturnValue(qb);

      await service.listAdmin({
        page: 1,
        limit: 10,
        instructorEmail: ' Instructor@Example.COM ',
        requestedAtFrom: '2026-09-01T00:00:00.000Z',
        requestedAtTo: '2026-09-30T23:59:59.999Z',
      } as ListAdminWithdrawRequestsQueryDto);

      expect(qb.andWhere).toHaveBeenCalledWith(
        'LOWER(instructor.email) LIKE :instructorEmail',
        { instructorEmail: '%instructor@example.com%' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'withdraw.requestedAt >= :requestedAtFrom',
        { requestedAtFrom: new Date('2026-09-01T00:00:00.000Z') },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'withdraw.requestedAt <= :requestedAtTo',
        { requestedAtTo: new Date('2026-09-30T23:59:59.999Z') },
      );
    });

    it('sorts latest first then amount ascending when requested', async () => {
      const qb = makeQueryBuilder([makeWithdrawRequest()], 1);
      withdrawRepo.createQueryBuilder.mockReturnValue(qb);

      await service.listAdmin({ page: 1, limit: 10, amountSort: 'asc' });

      expect(qb.orderBy).toHaveBeenCalledWith('withdraw.requestedAt', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('withdraw.amount', 'ASC');
    });

    it('returns instructor summary without requiring instructor id in response', async () => {
      const qb = makeQueryBuilder([
        makeWithdrawRequest({
          instructorId: otherInstructorId,
          instructor: makeUser({
            id: otherInstructorId,
            name: 'Tran Thi B',
            email: 'teacher@example.com',
          }),
        }),
      ]);
      withdrawRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listAdmin({
        page: 1,
        limit: 10,
      } as ListAdminWithdrawRequestsQueryDto);

      expect(result.items[0].instructor).toEqual({
        name: 'Tran Thi B',
        email: 'teacher@example.com',
      });
    });
  });

  describe('cancel', () => {
    it('cancels the current instructor pending request', async () => {
      const request = makeWithdrawRequest();
      withdrawRepo.findOne.mockResolvedValue(
        makeWithdrawRequest({
          status: WithdrawRequestStatus.CANCELLED,
          cancelReason: 'Doi y',
          cancelledAt: new Date('2026-09-13T10:00:00.000Z'),
        }),
      );

      const result = await service.cancel(makeUser(), requestId, {
        reason: ' Doi y ',
      });

      expect(withdrawRepo.update).toHaveBeenCalledWith(
        {
          id: request.id,
          instructorId,
          status: WithdrawRequestStatus.PENDING,
        },
        {
          status: WithdrawRequestStatus.CANCELLED,
          cancelReason: 'Doi y',
          cancelledAt: expect.any(Date),
        },
      );
      expect(result).toMatchObject({
        id: requestId,
        status: WithdrawRequestStatus.CANCELLED,
        cancelReason: 'Doi y',
      });
    });

    it('normalizes blank cancel reason to null', async () => {
      withdrawRepo.findOne.mockResolvedValue(
        makeWithdrawRequest({ status: WithdrawRequestStatus.CANCELLED }),
      );

      await service.cancel(makeUser(), requestId, { reason: '   ' });

      expect(withdrawRepo.update.mock.calls[0][1]).toMatchObject({
        cancelReason: null,
      });
    });

    it('rejects non-instructor callers', async () => {
      await expect(
        service.cancel(makeUser({ role: UserRole.LEARNER }), requestId, {}),
      ).rejects.toEqual(new BadRequestException('User is not an instructor'));
      expect(withdrawRepo.update).not.toHaveBeenCalled();
    });

    it('throws not found when the request does not exist', async () => {
      withdrawRepo.update.mockResolvedValue({ affected: 0 });
      withdrawRepo.findOne.mockResolvedValue(null);

      await expect(service.cancel(makeUser(), requestId, {})).rejects.toEqual(
        new NotFoundException('Withdraw request not found'),
      );
      expect(withdrawRepo.update).toHaveBeenCalled();
    });

    it('forbids cancelling another instructor request', async () => {
      withdrawRepo.update.mockResolvedValue({ affected: 0 });
      withdrawRepo.findOne.mockResolvedValue(
        makeWithdrawRequest({ instructorId: otherInstructorId }),
      );

      await expect(service.cancel(makeUser(), requestId, {})).rejects.toEqual(
        new ForbiddenException('Cannot cancel another instructor request'),
      );
      expect(withdrawRepo.update).toHaveBeenCalled();
    });

    it('rejects non-pending requests', async () => {
      withdrawRepo.update.mockResolvedValue({ affected: 0 });
      withdrawRepo.findOne.mockResolvedValue(
        makeWithdrawRequest({ status: WithdrawRequestStatus.CANCELLED }),
      );

      await expect(service.cancel(makeUser(), requestId, {})).rejects.toEqual(
        new BadRequestException(
          'Only pending withdraw requests can be cancelled',
        ),
      );
      expect(withdrawRepo.update).toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('rejects a pending request with instructor summary', async () => {
      withdrawRepo.findOne.mockResolvedValue(
        makeWithdrawRequest({
          status: WithdrawRequestStatus.REJECTED,
          rejectReason: 'Sai thong tin',
          rejectedAt: new Date('2026-09-13T10:00:00.000Z'),
          instructor: makeUser({
            name: 'Tran Thi B',
            email: 'teacher@example.com',
          }),
        }),
      );

      const result = await service.reject(requestId, {
        reason: ' Sai thong tin ',
      });

      expect(withdrawRepo.update).toHaveBeenCalledWith(
        { id: requestId, status: WithdrawRequestStatus.PENDING },
        {
          status: WithdrawRequestStatus.REJECTED,
          rejectReason: 'Sai thong tin',
          rejectedAt: expect.any(Date),
        },
      );
      expect(result).toMatchObject({
        id: requestId,
        status: WithdrawRequestStatus.REJECTED,
        rejectReason: 'Sai thong tin',
        instructor: {
          name: 'Tran Thi B',
          email: 'teacher@example.com',
        },
      });
    });

    it('throws not found when the request does not exist', async () => {
      withdrawRepo.update.mockResolvedValue({ affected: 0 });
      withdrawRepo.findOne.mockResolvedValue(null);

      await expect(
        service.reject(requestId, { reason: 'Sai thong tin' }),
      ).rejects.toEqual(new NotFoundException('Withdraw request not found'));
      expect(withdrawRepo.update).toHaveBeenCalled();
    });

    it('rejects non-pending requests', async () => {
      withdrawRepo.update.mockResolvedValue({ affected: 0 });
      withdrawRepo.findOne.mockResolvedValue(
        makeWithdrawRequest({ status: WithdrawRequestStatus.CANCELLED }),
      );

      await expect(
        service.reject(requestId, { reason: 'Sai thong tin' }),
      ).rejects.toEqual(
        new BadRequestException(
          'Only pending withdraw requests can be rejected',
        ),
      );
      expect(withdrawRepo.update).toHaveBeenCalled();
    });
  });

  describe('process', () => {
    it('moves a pending request to processing and returns VietQR payout detail', async () => {
      withdrawRepo.findOne
        .mockResolvedValueOnce(makeWithdrawRequest())
        .mockResolvedValueOnce(
          makeWithdrawRequest({
            status: WithdrawRequestStatus.PROCESSING,
            processingAt: new Date('2026-09-13T10:00:00.000Z'),
            payoutDescription: 'PAYOUT-WD-66666666',
            instructor: makeUser({
              name: 'Tran Thi B',
              email: 'teacher@example.com',
            }),
          }),
        );

      const result = await service.process(requestId);

      expect(accountRepo.findOne).toHaveBeenCalledWith({
        where: { instructorId },
      });
      expect(withdrawRepo.update).toHaveBeenCalledWith(
        { id: requestId, status: WithdrawRequestStatus.PENDING },
        {
          status: WithdrawRequestStatus.PROCESSING,
          processingAt: expect.any(Date),
          payoutDescription: 'PAYOUT-WD-66666666',
        },
      );
      expect(result).toMatchObject({
        id: requestId,
        status: WithdrawRequestStatus.PROCESSING,
        payoutDescription: 'PAYOUT-WD-66666666',
        payoutAccount: {
          bankName: 'VCB',
          bankCode: 'VCB',
          bankAccountNumber: '123456789',
          accountHolderName: 'NGUYEN VAN A',
        },
      });
      expect(result.qrImageUrl).toContain('https://vietqr.app/img?');
      expect(result.qrImageUrl).toContain('acc=123456789');
      expect(result.qrImageUrl).toContain('bank=VCB');
      expect(result.qrImageUrl).toContain('amount=1500000');
    });

    it('returns existing payout detail for an already processing request', async () => {
      withdrawRepo.findOne.mockResolvedValue(
        makeWithdrawRequest({
          status: WithdrawRequestStatus.PROCESSING,
          payoutDescription: 'PAYOUT-WD-66666666',
          processingAt: new Date('2026-09-13T10:00:00.000Z'),
        }),
      );

      const result = await service.process(requestId);

      expect(withdrawRepo.update).not.toHaveBeenCalled();
      expect(result.status).toBe(WithdrawRequestStatus.PROCESSING);
      expect(result.payoutDescription).toBe('PAYOUT-WD-66666666');
    });

    it('rejects processing when instructor payout account is incomplete', async () => {
      withdrawRepo.findOne.mockResolvedValue(makeWithdrawRequest());
      accountRepo.findOne.mockResolvedValue(makeAccount({ bankCode: null }));

      await expect(service.process(requestId)).rejects.toEqual(
        new BadRequestException('Instructor payout account is incomplete'),
      );
      expect(withdrawRepo.update).not.toHaveBeenCalled();
    });

    it('rejects invalid status for processing', async () => {
      withdrawRepo.findOne.mockResolvedValue(
        makeWithdrawRequest({ status: WithdrawRequestStatus.REJECTED }),
      );

      await expect(service.process(requestId)).rejects.toEqual(
        new BadRequestException(
          'Only pending withdraw requests can start processing',
        ),
      );
    });
  });

  describe('markProcessed', () => {
    it('marks a processing withdrawal as processed and records debit in one transaction', async () => {
      const processingWithdraw = makeWithdrawRequest({
        status: WithdrawRequestStatus.PROCESSING,
        payoutDescription: 'PAYOUT-WD-66666666',
      });
      const processedWithdraw = makeWithdrawRequest({
        status: WithdrawRequestStatus.PROCESSED,
        payoutReference: 'FT123456',
        processedAt: new Date('2026-09-13T11:00:00.000Z'),
        instructor: makeUser({
          name: 'Tran Thi B',
          email: 'teacher@example.com',
        }),
      });
      const managerWithdrawRepo = {
        findOne: jest.fn().mockResolvedValue(processingWithdraw),
        save: jest.fn().mockResolvedValue(processedWithdraw),
      };
      const manager = {
        getRepository: jest.fn().mockReturnValue(managerWithdrawRepo),
      };
      dataSource.transaction.mockImplementation(
        (callback: (txManager: typeof manager) => Promise<unknown>) =>
          callback(manager),
      );
      withdrawRepo.findOne.mockResolvedValue(processedWithdraw);

      const result = await service.markProcessed(requestId, {
        payoutReference: ' FT123456 ',
      });

      expect(managerWithdrawRepo.findOne).toHaveBeenCalledWith({
        where: { id: requestId },
      });
      expect(managerWithdrawRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: WithdrawRequestStatus.PROCESSED,
          payoutReference: 'FT123456',
          processedAt: expect.any(Date),
        }),
      );
      expect(instructorBalanceService.recordWithdrawDebit).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ status: WithdrawRequestStatus.PROCESSED }),
      );
      expect(result).toMatchObject({
        status: WithdrawRequestStatus.PROCESSED,
        payoutReference: 'FT123456',
      });
    });

    it('normalizes blank payout reference to null', async () => {
      const processingWithdraw = makeWithdrawRequest({
        status: WithdrawRequestStatus.PROCESSING,
      });
      const managerWithdrawRepo = {
        findOne: jest.fn().mockResolvedValue(processingWithdraw),
        save: jest.fn((input: unknown) => Promise.resolve(input)),
      };
      const manager = {
        getRepository: jest.fn().mockReturnValue(managerWithdrawRepo),
      };
      dataSource.transaction.mockImplementation(
        (callback: (txManager: typeof manager) => Promise<unknown>) =>
          callback(manager),
      );
      withdrawRepo.findOne.mockResolvedValue(
        makeWithdrawRequest({ status: WithdrawRequestStatus.PROCESSED }),
      );

      await service.markProcessed(requestId, { payoutReference: '   ' });

      expect(managerWithdrawRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ payoutReference: null }),
      );
    });

    it('rejects mark processed for non-processing withdrawals', async () => {
      const managerWithdrawRepo = {
        findOne: jest.fn().mockResolvedValue(makeWithdrawRequest()),
      };
      const manager = {
        getRepository: jest.fn().mockReturnValue(managerWithdrawRepo),
      };
      dataSource.transaction.mockImplementation(
        (callback: (txManager: typeof manager) => Promise<unknown>) =>
          callback(manager),
      );

      await expect(service.markProcessed(requestId, {})).rejects.toEqual(
        new BadRequestException(
          'Only processing withdraw requests can be marked processed',
        ),
      );
    });
  });

  describe('recordProcessedDebit', () => {
    it('creates a ledger debit for processed withdrawals', async () => {
      const withdraw = makeWithdrawRequest({
        status: WithdrawRequestStatus.PROCESSED,
        amount: 1500000,
      });
      const managerWithdrawRepo = {
        findOne: jest.fn().mockResolvedValue(withdraw),
      };
      const manager = {
        getRepository: jest.fn().mockReturnValue(managerWithdrawRepo),
      };
      dataSource.transaction.mockImplementation(
        (callback: (txManager: typeof manager) => Promise<unknown>) =>
          callback(manager),
      );

      await service.recordProcessedDebit(requestId);

      expect(managerWithdrawRepo.findOne).toHaveBeenCalledWith({
        where: { id: requestId },
      });
      expect(instructorBalanceService.recordWithdrawDebit).toHaveBeenCalledWith(
        manager,
        withdraw,
      );
    });

    it('rejects debit creation for non-processed withdrawals', async () => {
      const managerWithdrawRepo = {
        findOne: jest.fn().mockResolvedValue(makeWithdrawRequest()),
      };
      const manager = {
        getRepository: jest.fn().mockReturnValue(managerWithdrawRepo),
      };
      dataSource.transaction.mockImplementation(
        (callback: (txManager: typeof manager) => Promise<unknown>) =>
          callback(manager),
      );

      await expect(service.recordProcessedDebit(requestId)).rejects.toEqual(
        new BadRequestException(
          'Only processed withdraw requests can create balance debit entries',
        ),
      );
      expect(
        instructorBalanceService.recordWithdrawDebit,
      ).not.toHaveBeenCalled();
    });

    it('throws not found when the withdrawal does not exist', async () => {
      const managerWithdrawRepo = {
        findOne: jest.fn().mockResolvedValue(null),
      };
      const manager = {
        getRepository: jest.fn().mockReturnValue(managerWithdrawRepo),
      };
      dataSource.transaction.mockImplementation(
        (callback: (txManager: typeof manager) => Promise<unknown>) =>
          callback(manager),
      );

      await expect(service.recordProcessedDebit(requestId)).rejects.toEqual(
        new NotFoundException('Withdraw request not found'),
      );
    });
  });
});
