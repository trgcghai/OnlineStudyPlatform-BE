import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Course } from '../courses/entities/course.entity';
import { User, UserRole } from '../users/entities/user.entity';
import {
  InstructorBalanceHistoryItem,
  InstructorBalanceHistoryResponse,
  InstructorBalanceSummaryResponse,
  ListInstructorBalanceHistoryQueryDto,
} from './dto/instructor-balance.dto';
import {
  InstructorBalanceLedger,
  InstructorBalanceLedgerType,
} from './entities/instructor-balance-ledger.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
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
