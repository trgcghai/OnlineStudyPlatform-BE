import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { Course } from '../courses/entities/course.entity';
import { User, UserRole } from '../users/entities/user.entity';
import {
  InstructorBalanceHistoryItem,
  InstructorBalanceHistoryResponse,
  InstructorRevenueReportResponse,
  ListInstructorRevenueReportQueryDto,
  InstructorBalanceSummaryResponse,
  ListInstructorBalanceHistoryQueryDto,
} from './dto/instructor-balance.dto';
import {
  InstructorBalanceLedger,
  InstructorBalanceLedgerType,
} from './entities/instructor-balance-ledger.entity';
import {
  PaymentStatus,
  PaymentTransaction,
} from './entities/payment-transaction.entity';
import { WithdrawRequest } from './entities/withdraw-request.entity';

interface RecordEarningInput {
  manager: EntityManager;
  payment: PaymentTransaction;
  course: Course;
  orderItemId?: string | null;
  grossAmount?: number;
  platformFeeAmount: number;
  netAmount: number;
  availableAt: Date;
}

@Injectable()
export class InstructorBalanceService {
  constructor(
    @InjectRepository(InstructorBalanceLedger)
    private readonly ledgerRepository: Repository<InstructorBalanceLedger>,
    @InjectRepository(PaymentTransaction)
    private readonly paymentRepository: Repository<PaymentTransaction>,
  ) {}

  async getSummary(
    currentUser: Pick<User, 'id' | 'role'>,
  ): Promise<InstructorBalanceSummaryResponse> {
    this.assertInstructor(currentUser);

    const raw = await this.ledgerRepository
      .createQueryBuilder('ledger')
      .select('COALESCE(SUM(ledger.amountDelta), 0)', 'currentBalance')
      .addSelect('COALESCE(SUM(ledger.amountDelta), 0)', 'totalBalance')
      .addSelect(
        'COALESCE(SUM(CASE WHEN (ledger.type = :earningType AND "ledger"."available_at" <= :now) OR ledger.type = :withdrawType THEN ledger.amountDelta ELSE 0 END), 0)',
        'withdrawableBalance',
      )
      .addSelect(
        'COALESCE(SUM(CASE WHEN ledger.type = :earningType AND ("ledger"."available_at" IS NULL OR "ledger"."available_at" > :now) THEN ledger.amountDelta ELSE 0 END), 0)',
        'nonWithdrawableBalance',
      )
      .addSelect(
        'COALESCE(SUM(CASE WHEN ledger.type = :earningType THEN ledger.amountDelta ELSE 0 END), 0)',
        'totalEarned',
      )
      .addSelect(
        'ABS(COALESCE(SUM(CASE WHEN ledger.type = :withdrawType THEN ledger.amountDelta ELSE 0 END), 0))',
        'totalWithdrawn',
      )
      .addSelect('COALESCE(MAX(ledger.currency), :currency)', 'currency')
      .where('ledger.instructorId = :instructorId', {
        instructorId: currentUser.id,
      })
      .setParameters({
        earningType: InstructorBalanceLedgerType.EARNING_CREDIT,
        withdrawType: InstructorBalanceLedgerType.WITHDRAW_DEBIT,
        currency: 'VND',
        now: new Date(),
      })
      .getRawOne<{
        totalBalance: string | null;
        currentBalance: string | null;
        withdrawableBalance: string | null;
        nonWithdrawableBalance: string | null;
        totalEarned: string | null;
        totalWithdrawn: string | null;
        currency: string | null;
      }>();

    return {
      totalBalance: this.toNumber(raw?.totalBalance),
      currentBalance: this.toNumber(raw?.currentBalance),
      withdrawableBalance: this.toNumber(raw?.withdrawableBalance),
      nonWithdrawableBalance: this.toNumber(raw?.nonWithdrawableBalance),
      totalEarned: this.toNumber(raw?.totalEarned),
      totalWithdrawn: this.toNumber(raw?.totalWithdrawn),
      currency: raw?.currency ?? 'VND',
    };
  }

  async listHistory(
    currentUser: Pick<User, 'id' | 'role'>,
    query: ListInstructorBalanceHistoryQueryDto,
  ): Promise<InstructorBalanceHistoryResponse> {
    this.assertInstructor(currentUser);

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const [items, total] = await this.ledgerRepository
      .createQueryBuilder('ledger')
      .leftJoinAndSelect('ledger.course', 'course')
      .where('ledger.instructorId = :instructorId', {
        instructorId: currentUser.id,
      })
      .orderBy('ledger.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items: items.map((item) => this.toHistoryItem(item)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getRevenueReport(
    currentUser: Pick<User, 'id' | 'role'>,
    query: ListInstructorRevenueReportQueryDto,
  ): Promise<InstructorRevenueReportResponse> {
    this.assertInstructor(currentUser);

    const dateRange = this.resolveDateRange(query);
    const courseQuery = this.ledgerRepository
      .createQueryBuilder('ledger')
      .innerJoin('ledger.course', 'course')
      .select('course.id', 'courseId')
      .addSelect('course.title', 'courseTitle')
      .addSelect('COUNT(ledger.id)', 'purchaseCount')
      .addSelect('COALESCE(SUM(ledger.grossAmount), 0)', 'grossRevenue')
      .addSelect('COALESCE(SUM(ledger.platformFeeAmount), 0)', 'platformFee')
      .addSelect('COALESCE(SUM(ledger.netAmount), 0)', 'netRevenue')
      .addSelect('COALESCE(MAX(ledger.currency), :currency)', 'currency')
      .where('ledger.instructorId = :instructorId', {
        instructorId: currentUser.id,
      })
      .andWhere('ledger.type = :earningType', {
        earningType: InstructorBalanceLedgerType.EARNING_CREDIT,
      })
      .setParameter('currency', 'VND')
      .groupBy('course.id')
      .addGroupBy('course.title')
      .orderBy('grossRevenue', 'DESC');

    this.applyDateRange(courseQuery, 'ledger.createdAt', dateRange);

    const courseRows = await courseQuery.getRawMany<{
      courseId: string;
      courseTitle: string;
      purchaseCount: string;
      grossRevenue: string;
      platformFee: string;
      netRevenue: string;
      currency: string | null;
    }>();

    const paymentQuery = this.paymentRepository
      .createQueryBuilder('transaction')
      .innerJoin('transaction.order', 'order')
      .innerJoin(
        'order.items',
        'orderItem',
        'orderItem.instructorId = :instructorId',
        { instructorId: currentUser.id },
      )
      .select('transaction.status', 'status')
      .addSelect('COUNT(DISTINCT transaction.id)', 'transactionCount')
      .addSelect('COALESCE(SUM(orderItem.unitPrice), 0)', 'amount')
      .addSelect('COALESCE(MAX(transaction.currency), :currency)', 'currency')
      .setParameter('currency', 'VND')
      .groupBy('transaction.status')
      .orderBy('transaction.status', 'ASC');

    this.applyDateRange(paymentQuery, 'transaction.createdAt', dateRange);

    const paymentRows = await paymentQuery.getRawMany<{
      status: PaymentStatus;
      transactionCount: string;
      amount: string;
      currency: string | null;
    }>();

    const courses = courseRows.map((row) => ({
      courseId: row.courseId,
      courseTitle: row.courseTitle,
      purchaseCount: this.toNumber(row.purchaseCount),
      grossRevenue: this.toNumber(row.grossRevenue),
      platformFee: this.toNumber(row.platformFee),
      netRevenue: this.toNumber(row.netRevenue),
      currency: row.currency ?? 'VND',
    }));

    const paymentStatsByStatus = new Map(
      paymentRows.map((row) => [row.status, row]),
    );
    const paymentStats = Object.values(PaymentStatus).map((status) => {
      const row = paymentStatsByStatus.get(status);

      return {
        status,
        transactionCount: this.toNumber(row?.transactionCount),
        amount: this.toNumber(row?.amount),
        currency: row?.currency ?? 'VND',
      };
    });

    return {
      dateFrom: query.dateFrom ?? null,
      dateTo: query.dateTo ?? null,
      summary: {
        purchaseCount: courses.reduce(
          (total, course) => total + course.purchaseCount,
          0,
        ),
        grossRevenue: courses.reduce(
          (total, course) => total + course.grossRevenue,
          0,
        ),
        platformFee: courses.reduce(
          (total, course) => total + course.platformFee,
          0,
        ),
        netRevenue: courses.reduce(
          (total, course) => total + course.netRevenue,
          0,
        ),
        currency: courses[0]?.currency ?? paymentStats[0]?.currency ?? 'VND',
      },
      courses,
      paymentStats,
    };
  }

  async recordEarningCredit(input: RecordEarningInput): Promise<void> {
    const repo = input.manager.getRepository(InstructorBalanceLedger);
    const existing = await repo.findOne({
      where: input.orderItemId
        ? { orderItemId: input.orderItemId }
        : { paymentTransactionId: input.payment.id },
    });
    if (existing) return;

    await repo.save(
      repo.create({
        instructorId: input.course.instructorId,
        type: InstructorBalanceLedgerType.EARNING_CREDIT,
        amountDelta: input.netAmount,
        currency: input.payment.currency,
        grossAmount: input.grossAmount ?? input.payment.amount,
        platformFeeAmount: input.platformFeeAmount,
        netAmount: input.netAmount,
        courseId: input.course.id,
        paymentTransactionId: input.payment.id,
        orderItemId: input.orderItemId ?? null,
        withdrawRequestId: null,
        availableAt: input.availableAt,
        description: `Doanh thu khóa học ${input.course.title}`,
      }),
    );
  }

  async recordWithdrawDebit(
    manager: EntityManager,
    withdraw: WithdrawRequest,
  ): Promise<void> {
    const repo = manager.getRepository(InstructorBalanceLedger);
    const existing = await repo.findOne({
      where: { withdrawRequestId: withdraw.id },
    });
    if (existing) return;

    await repo.save(
      repo.create({
        instructorId: withdraw.instructorId,
        type: InstructorBalanceLedgerType.WITHDRAW_DEBIT,
        amountDelta: -withdraw.amount,
        currency: withdraw.currency,
        grossAmount: null,
        platformFeeAmount: null,
        netAmount: null,
        courseId: null,
        paymentTransactionId: null,
        withdrawRequestId: withdraw.id,
        availableAt: null,
        description: 'Rút tiền đã xử lý thành công',
      }),
    );
  }

  private assertInstructor(currentUser: Pick<User, 'role'>): void {
    if (currentUser.role !== UserRole.INSTRUCTOR) {
      throw new BadRequestException('User is not an instructor');
    }
  }

  private resolveDateRange(query: ListInstructorRevenueReportQueryDto): {
    from?: Date;
    to?: Date;
  } {
    const from = query.dateFrom ? new Date(query.dateFrom) : undefined;
    const to = query.dateTo ? new Date(query.dateTo) : undefined;

    if (from && Number.isNaN(from.getTime())) {
      throw new BadRequestException('dateFrom is invalid');
    }

    if (to && Number.isNaN(to.getTime())) {
      throw new BadRequestException('dateTo is invalid');
    }

    if (from && to && from > to) {
      throw new BadRequestException(
        'dateFrom must be before or equal to dateTo',
      );
    }

    if (to && /^\d{4}-\d{2}-\d{2}$/.test(query.dateTo ?? '')) {
      to.setUTCDate(to.getUTCDate() + 1);
    }

    return { from, to };
  }

  private applyDateRange(
    queryBuilder: SelectQueryBuilder<ObjectLiteral>,
    column: string,
    dateRange: { from?: Date; to?: Date },
  ): void {
    if (dateRange.from) {
      queryBuilder.andWhere(`${column} >= :dateFrom`, {
        dateFrom: dateRange.from,
      });
    }

    if (dateRange.to) {
      queryBuilder.andWhere(`${column} < :dateTo`, {
        dateTo: dateRange.to,
      });
    }
  }

  private toNumber(value: string | null | undefined): number {
    const numeric = Number(value ?? 0);

    return Number.isFinite(numeric) ? numeric : 0;
  }

  private toHistoryItem(
    ledger: InstructorBalanceLedger,
  ): InstructorBalanceHistoryItem {
    return {
      id: ledger.id,
      type: ledger.type,
      amountDelta: ledger.amountDelta,
      currency: ledger.currency,
      grossAmount: ledger.grossAmount,
      platformFeeAmount: ledger.platformFeeAmount,
      netAmount: ledger.netAmount,
      description: ledger.description,
      availableAt: ledger.availableAt,
      createdAt: ledger.createdAt,
      course: ledger.course
        ? { id: ledger.course.id, title: ledger.course.title }
        : null,
      paymentTransactionId: ledger.paymentTransactionId,
      withdrawRequestId: ledger.withdrawRequestId,
    };
  }
}
