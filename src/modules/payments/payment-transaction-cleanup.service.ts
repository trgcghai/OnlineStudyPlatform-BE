import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual, Repository } from 'typeorm';
import {
  PaymentAuditActorType,
  PaymentAuditLog,
} from './entities/payment-audit.entity';
import {
  PaymentStatus,
  PaymentTransaction,
} from './entities/payment-transaction.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/entities/order-status.enum';

const PAYMENT_CLEANUP_BATCH_SIZE = 100;
const PAYMENT_CLEANUP_REASON =
  'Payment transaction expired by scheduled cleanup';

@Injectable()
export class PaymentTransactionCleanupService {
  private readonly logger = new Logger(PaymentTransactionCleanupService.name);

  constructor(
    @InjectRepository(PaymentTransaction)
    private readonly transactionsRepository: Repository<PaymentTransaction>,
    private readonly dataSource: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async runCleanup(now: Date = new Date()): Promise<void> {
    const candidates = await this.transactionsRepository.find({
      where: {
        status: PaymentStatus.PENDING,
        expiresAt: LessThanOrEqual(now),
      },
      order: { expiresAt: 'ASC' },
      take: PAYMENT_CLEANUP_BATCH_SIZE,
    });

    let expiredCount = 0;

    for (const candidate of candidates) {
      try {
        const expired = await this.expireCandidate(candidate.id, now);
        if (expired) expiredCount += 1;
      } catch (error) {
        this.logger.error(
          `Failed to expire payment transaction ${candidate.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    this.logger.log(
      `Marked ${expiredCount} expired payment transactions as expired`,
    );
  }

  private async expireCandidate(
    transactionId: string,
    now: Date,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const transactionsRepository = manager.getRepository(PaymentTransaction);
      const auditsRepository = manager.getRepository(PaymentAuditLog);
      const ordersRepository = manager.getRepository(Order);
      const transaction = await transactionsRepository.findOne({
        where: { id: transactionId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!transaction) return false;
      if (transaction.status !== PaymentStatus.PENDING) return false;
      if (transaction.expiresAt > now) return false;

      transaction.status = PaymentStatus.EXPIRED;
      const saved = await transactionsRepository.save(transaction);

      if (saved.orderId) {
        const order = await ordersRepository.findOne({
          where: { id: saved.orderId },
        });
        if (order?.status === OrderStatus.PENDING) {
          order.status = OrderStatus.EXPIRED;
          await ordersRepository.save(order);
        }
      }

      await auditsRepository.save(
        auditsRepository.create({
          transactionId: saved.id,
          actorType: PaymentAuditActorType.SYSTEM,
          actorId: null,
          fromStatus: PaymentStatus.PENDING,
          toStatus: PaymentStatus.EXPIRED,
          amount: saved.amount,
          paymentCode: saved.paymentCode,
          providerTransactionId: saved.providerTransactionId ?? null,
          reason: PAYMENT_CLEANUP_REASON,
        }),
      );

      return true;
    });
  }
}
