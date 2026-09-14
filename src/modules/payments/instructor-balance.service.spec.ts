import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import {
  InstructorBalanceLedger,
  InstructorBalanceLedgerType,
} from './entities/instructor-balance-ledger.entity';
import { InstructorBalanceService } from './instructor-balance.service';

describe('InstructorBalanceService', () => {
  let service: InstructorBalanceService;
  let ledgerRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  const instructorId = '44444444-4444-4444-8444-444444444444';
  const otherInstructorId = '55555555-5555-4555-8555-555555555555';
  const paymentTransactionId = '33333333-3333-4333-8333-333333333333';
  const withdrawRequestId = '66666666-6666-4666-8666-666666666666';
  const courseId = '22222222-2222-4222-8222-222222222222';

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

  const makeLedger = (
    overrides: Partial<InstructorBalanceLedger> = {},
  ): InstructorBalanceLedger => ({
    id: '77777777-7777-4777-8777-777777777777',
    instructorId,
    instructor: makeUser(),
    type: InstructorBalanceLedgerType.EARNING_CREDIT,
    amountDelta: 159200,
    currency: 'VND',
    grossAmount: 199000,
    platformFeeAmount: 39800,
    netAmount: 159200,
    courseId,
    course: { id: courseId, title: 'Lap trinh NestJS' } as never,
    paymentTransactionId,
    paymentTransaction: null,
    withdrawRequestId: null,
    withdrawRequest: null,
    description: 'Doanh thu khoa hoc Lap trinh NestJS',
    availableAt: new Date('2026-09-21T08:00:00.000Z'),
    createdAt: new Date('2026-09-14T08:00:00.000Z'),
    ...overrides,
  });

  function makeSummaryQueryBuilder(raw: Record<string, string | null>) {
    return {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(raw),
    };
  }

  function makeListQueryBuilder(
    items: InstructorBalanceLedger[],
    total = items.length,
  ) {
    return {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([items, total]),
    };
  }

  beforeEach(() => {
    ledgerRepo = {
      create: jest.fn((input: Partial<InstructorBalanceLedger>) => input),
      save: jest.fn((input: Partial<InstructorBalanceLedger>) =>
        Promise.resolve(makeLedger(input)),
      ),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    service = new InstructorBalanceService(
      ledgerRepo as unknown as Repository<InstructorBalanceLedger>,
    );
  });

  it('summarizes current balance, total earned, and total withdrawn from ledger rows', async () => {
    const qb = makeSummaryQueryBuilder({
      totalBalance: '109200',
      currentBalance: '109200',
      withdrawableBalance: '59200',
      nonWithdrawableBalance: '50000',
      totalEarned: '159200',
      totalWithdrawn: '50000',
      currency: 'VND',
    });
    ledgerRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.getSummary(makeUser());

    expect(qb.where).toHaveBeenCalledWith(
      'ledger.instructorId = :instructorId',
      { instructorId },
    );
    expect(result).toEqual({
      totalBalance: 109200,
      currentBalance: 109200,
      withdrawableBalance: 59200,
      nonWithdrawableBalance: 50000,
      totalEarned: 159200,
      totalWithdrawn: 50000,
      currency: 'VND',
    });
  });

  it('lists only current instructor ledger history newest first', async () => {
    const qb = makeListQueryBuilder([
      makeLedger({ description: 'Doanh thu khoa hoc Lap trinh NestJS' }),
    ]);
    ledgerRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.listHistory(makeUser(), { page: 2, limit: 5 });

    expect(qb.where).toHaveBeenCalledWith(
      'ledger.instructorId = :instructorId',
      { instructorId },
    );
    expect(qb.orderBy).toHaveBeenCalledWith('ledger.createdAt', 'DESC');
    expect(qb.skip).toHaveBeenCalledWith(5);
    expect(qb.take).toHaveBeenCalledWith(5);
    expect(result).toMatchObject({
      total: 1,
      page: 2,
      limit: 5,
      totalPages: 1,
    });
    expect(result.items[0]).toMatchObject({
      type: InstructorBalanceLedgerType.EARNING_CREDIT,
      amountDelta: 159200,
      availableAt: new Date('2026-09-21T08:00:00.000Z'),
      course: { title: 'Lap trinh NestJS' },
    });
  });

  it('rejects non-instructors for summary and history', async () => {
    const learner = makeUser({ role: UserRole.LEARNER, id: otherInstructorId });

    await expect(service.getSummary(learner)).rejects.toEqual(
      new BadRequestException('User is not an instructor'),
    );
    await expect(
      service.listHistory(learner, { page: 1, limit: 10 }),
    ).rejects.toEqual(new BadRequestException('User is not an instructor'));
  });

  it('records an earning credit once for a paid payment', async () => {
    const managerRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((input: Partial<InstructorBalanceLedger>) => input),
      save: jest.fn(),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(managerRepo) };

    await service.recordEarningCredit({
      manager: manager as never,
      payment: {
        id: paymentTransactionId,
        amount: 199000,
        currency: 'VND',
      } as never,
      course: {
        id: courseId,
        title: 'Lap trinh NestJS',
        instructorId,
      } as never,
      platformFeeAmount: 39800,
      netAmount: 159200,
      availableAt: new Date('2026-09-21T08:00:00.000Z'),
    });

    expect(managerRepo.findOne).toHaveBeenCalledWith({
      where: { paymentTransactionId },
    });
    expect(managerRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        instructorId,
        type: InstructorBalanceLedgerType.EARNING_CREDIT,
        amountDelta: 159200,
        grossAmount: 199000,
        platformFeeAmount: 39800,
        netAmount: 159200,
        availableAt: new Date('2026-09-21T08:00:00.000Z'),
        paymentTransactionId,
      }),
    );
    expect(managerRepo.save).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate an existing earning credit', async () => {
    const managerRepo = {
      findOne: jest.fn().mockResolvedValue(makeLedger()),
      create: jest.fn(),
      save: jest.fn(),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(managerRepo) };

    await service.recordEarningCredit({
      manager: manager as never,
      payment: {
        id: paymentTransactionId,
        amount: 199000,
        currency: 'VND',
      } as never,
      course: { id: courseId, title: 'NestJS', instructorId } as never,
      platformFeeAmount: 39800,
      netAmount: 159200,
      availableAt: new Date('2026-09-21T08:00:00.000Z'),
    });

    expect(managerRepo.create).not.toHaveBeenCalled();
    expect(managerRepo.save).not.toHaveBeenCalled();
  });

  it('records a withdrawal debit once for a processed withdrawal', async () => {
    const managerRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((input: Partial<InstructorBalanceLedger>) => input),
      save: jest.fn(),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(managerRepo) };

    await service.recordWithdrawDebit(
      manager as never,
      {
        id: withdrawRequestId,
        instructorId,
        amount: 50000,
        currency: 'VND',
      } as never,
    );

    expect(managerRepo.findOne).toHaveBeenCalledWith({
      where: { withdrawRequestId },
    });
    expect(managerRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        instructorId,
        type: InstructorBalanceLedgerType.WITHDRAW_DEBIT,
        amountDelta: -50000,
        withdrawRequestId,
      }),
    );
  });

  it('does not duplicate an existing withdrawal debit', async () => {
    const managerRepo = {
      findOne: jest.fn().mockResolvedValue(
        makeLedger({
          type: InstructorBalanceLedgerType.WITHDRAW_DEBIT,
          withdrawRequestId,
        }),
      ),
      create: jest.fn(),
      save: jest.fn(),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(managerRepo) };

    await service.recordWithdrawDebit(
      manager as never,
      {
        id: withdrawRequestId,
        instructorId,
        amount: 50000,
        currency: 'VND',
      } as never,
    );

    expect(managerRepo.create).not.toHaveBeenCalled();
    expect(managerRepo.save).not.toHaveBeenCalled();
  });
});
