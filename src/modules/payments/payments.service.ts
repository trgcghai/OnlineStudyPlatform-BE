import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CheckoutResponse,
  PaymentTransactionResponse,
  SE_PAY_TRANSFER_IN,
  SePayWebhookPayload,
} from './dto/payment.dto';
import {
  PaymentAuditActorType,
  PaymentAuditActorTypeValue,
  PaymentAuditLog,
} from './entities/payment-audit.entity';
import {
  PaymentStatus,
  PaymentTransaction,
} from './entities/payment-transaction.entity';

const FREE_COURSE_PRICE = 0;
const DUPLICATE_ENROLLMENT_ERROR = 'Bạn đã đăng ký khóa học này';
const COURSE_NOT_FOUND_ERROR = 'Course not found';
const TRANSACTION_NOT_FOUND_ERROR = 'Payment transaction not found';
const PUBLISHED_ONLY_ERROR = 'Chỉ có thể thanh toán cho khóa học đã xuất bản';
const FREE_COURSE_ERROR = 'Khóa học miễn phí không cần thanh toán';
const PAYMENT_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const VIET_QR_URL = 'https://vietqr.app/img';
const SE_PAY_MEMO_PREFIX = 'SEVQR';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(PaymentTransaction)
    private readonly transactionsRepository: Repository<PaymentTransaction>,
    @InjectRepository(PaymentAuditLog)
    private readonly auditsRepository: Repository<PaymentAuditLog>,
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    @InjectRepository(Enrollment)
    private readonly enrollmentsRepository: Repository<Enrollment>,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async createCheckout(
    learnerId: string,
    courseId: string,
  ): Promise<CheckoutResponse> {
    const course = await this.coursesRepository.findOne({
      where: { id: courseId },
    });

    if (!course) {
      throw new NotFoundException(COURSE_NOT_FOUND_ERROR);
    }

    if (course.status !== CourseStatus.PUBLISHED) {
      throw new BadRequestException(PUBLISHED_ONLY_ERROR);
    }

    if (course.price <= FREE_COURSE_PRICE) {
      throw new BadRequestException(FREE_COURSE_ERROR);
    }

    const existingEnrollment = await this.enrollmentsRepository.findOne({
      where: { learnerId, courseId },
    });

    if (existingEnrollment) {
      throw new ConflictException(DUPLICATE_ENROLLMENT_ERROR);
    }

    const existingPending = await this.transactionsRepository.findOne({
      where: { learnerId, courseId, status: PaymentStatus.PENDING },
      order: { createdAt: 'DESC' },
    });

    if (existingPending) {
      const refreshed = await this.expireIfNeeded(existingPending);
      if (refreshed.status === PaymentStatus.PENDING) {
        return this.toCheckoutResponse(refreshed);
      }
    }

    const paymentCode = await this.generateUniquePaymentCode();
    const transaction = this.transactionsRepository.create({
      learnerId,
      courseId,
      amount: course.price,
      currency: 'VND',
      status: PaymentStatus.PENDING,
      paymentCode,
      provider: 'sepay',
      providerTransactionId: null,
      providerGateway: null,
      providerReferenceCode: null,
      expiresAt: this.computeExpiresAt(),
      paidAt: null,
    });

    const saved = await this.transactionsRepository.save(transaction);
    await this.writeAudit(
      saved,
      PaymentAuditActorType.SYSTEM,
      null,
      null,
      PaymentStatus.PENDING,
      'Checkout created',
    );

    return this.toCheckoutResponse(saved);
  }

  async getOwnedTransaction(
    learnerId: string,
    transactionId: string,
  ): Promise<CheckoutResponse> {
    const transaction = await this.assertOwner(learnerId, transactionId);
    const refreshed = await this.expireIfNeeded(transaction);

    return this.toCheckoutResponse(refreshed);
  }

  async cancelOwnedTransaction(
    learnerId: string,
    transactionId: string,
  ): Promise<CheckoutResponse> {
    const transaction = await this.assertOwner(learnerId, transactionId);

    if (transaction.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(
        'Chỉ có thể hủy giao dịch đang chờ thanh toán',
      );
    }

    if (transaction.expiresAt < new Date()) {
      throw new BadRequestException('Giao dịch đã hết hạn');
    }

    transaction.status = PaymentStatus.CANCELLED;
    const saved = await this.transactionsRepository.save(transaction);
    await this.writeAudit(
      saved,
      PaymentAuditActorType.LEARNER,
      learnerId,
      PaymentStatus.PENDING,
      PaymentStatus.CANCELLED,
      'Learner cancelled checkout',
    );

    return this.toCheckoutResponse(saved);
  }

  async processSePayWebhook(payload: SePayWebhookPayload): Promise<void> {
    if (payload.transferType !== SE_PAY_TRANSFER_IN) {
      return;
    }

    const providerTransactionId = String(payload.id);

    const alreadyProcessed = await this.transactionsRepository.findOne({
      where: { providerTransactionId },
    });

    if (alreadyProcessed) {
      return;
    }

    const paymentCode = this.resolveSePayPaymentCode(payload);
    if (!paymentCode) {
      return;
    }

    const transaction = await this.transactionsRepository.findOne({
      where: { paymentCode },
    });

    if (!transaction || transaction.status !== PaymentStatus.PENDING) {
      return;
    }

    if (payload.transferAmount < transaction.amount) {
      transaction.status = PaymentStatus.FAILED;
      const saved = await this.transactionsRepository.save(transaction);
      await this.writeAudit(
        saved,
        PaymentAuditActorType.SEPAY,
        null,
        PaymentStatus.PENDING,
        PaymentStatus.FAILED,
        `Số tiền chuyển khoản ${payload.transferAmount} nhỏ hơn ${transaction.amount}`,
      );
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      const transactionsRepository = manager.getRepository(PaymentTransaction);
      const payment = await transactionsRepository.findOne({
        where: { id: transaction.id },
      });

      if (!payment || payment.status !== PaymentStatus.PENDING) {
        return;
      }

      payment.status = PaymentStatus.PAID;
      payment.providerTransactionId = providerTransactionId;
      payment.providerGateway = payload.gateway || null;
      payment.providerReferenceCode = payload.referenceCode ?? null;
      payment.paidAt = new Date();
      const saved = await transactionsRepository.save(payment);

      await manager.getRepository(PaymentAuditLog).save(
        manager.getRepository(PaymentAuditLog).create({
          transactionId: saved.id,
          actorType: PaymentAuditActorType.SEPAY,
          actorId: null,
          fromStatus: PaymentStatus.PENDING,
          toStatus: PaymentStatus.PAID,
          amount: saved.amount,
          paymentCode: saved.paymentCode,
          providerTransactionId: saved.providerTransactionId,
          reason: 'Payment confirmed by SePay',
        }),
      );

      const enrollmentsRepository = manager.getRepository(Enrollment);
      const existing = await enrollmentsRepository.findOne({
        where: { learnerId: saved.learnerId, courseId: saved.courseId },
      });

      if (existing) {
        return;
      }

      await enrollmentsRepository.save(
        enrollmentsRepository.create({
          learnerId: saved.learnerId,
          courseId: saved.courseId,
          progress: '0.00',
          completedAt: null,
        }),
      );
    });

    await this.notificationsService.createDirectNotification({
      userId: transaction.learnerId,
      title: 'Thanh toán thành công',
      message: 'Bạn đã đăng ký khóa học. Chúc bạn học tập vui vẻ!',
      actionUrl: `/learner/courses/${transaction.courseId}/learn`,
      metadata: {
        courseId: transaction.courseId,
        transactionId: transaction.id,
      },
    });
  }

  private async assertOwner(
    learnerId: string,
    transactionId: string,
  ): Promise<PaymentTransaction> {
    const transaction = await this.transactionsRepository.findOne({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new NotFoundException(TRANSACTION_NOT_FOUND_ERROR);
    }

    if (transaction.learnerId !== learnerId) {
      throw new ForbiddenException('Bạn không có quyền truy cập giao dịch này');
    }

    return transaction;
  }

  private async expireIfNeeded(
    transaction: PaymentTransaction,
  ): Promise<PaymentTransaction> {
    if (
      transaction.status !== PaymentStatus.PENDING ||
      transaction.expiresAt >= new Date()
    ) {
      return transaction;
    }

    transaction.status = PaymentStatus.EXPIRED;
    const saved = await this.transactionsRepository.save(transaction);
    await this.writeAudit(
      saved,
      PaymentAuditActorType.SYSTEM,
      null,
      PaymentStatus.PENDING,
      PaymentStatus.EXPIRED,
      'Transaction expired without payment',
    );

    return saved;
  }

  private async writeAudit(
    transaction: PaymentTransaction,
    actorType: PaymentAuditActorTypeValue,
    actorId: string | null,
    fromStatus: PaymentStatus | null,
    toStatus: PaymentStatus,
    reason: string,
  ): Promise<void> {
    await this.auditsRepository.save(
      this.auditsRepository.create({
        transactionId: transaction.id,
        actorType,
        actorId,
        fromStatus,
        toStatus,
        amount: transaction.amount,
        paymentCode: transaction.paymentCode,
        providerTransactionId: transaction.providerTransactionId ?? null,
        reason,
      }),
    );
  }

  private async generateUniquePaymentCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const paymentCode = this.buildPaymentCode();
      const exists = await this.transactionsRepository.exists({
        where: { paymentCode },
      });
      if (!exists) {
        return paymentCode;
      }
    }

    throw new Error('Could not generate a unique payment code');
  }

  private buildPaymentCode(): string {
    const prefix = this.configService.get<string>(
      'SEPAY_PAYMENT_CODE_PREFIX',
      'KLTN',
    );
    const now = new Date();
    const timestamp = [
      now.getFullYear(),
      this.pad(now.getMonth() + 1),
      this.pad(now.getDate()),
      this.pad(now.getHours()),
      this.pad(now.getMinutes()),
      this.pad(now.getSeconds()),
    ].join('');
    const random = Array.from({ length: 6 }, () => {
      const randomChar = randomBytes(1)[0];
      return PAYMENT_CODE_CHARS[randomChar % PAYMENT_CODE_CHARS.length];
    }).join('');

    return `${prefix}${timestamp}${random}`;
  }

  private pad(value: number): string {
    return String(value).padStart(2, '0');
  }

  private resolveSePayPaymentCode(payload: SePayWebhookPayload): string | null {
    const prefix = this.configService.get<string>(
      'SEPAY_PAYMENT_CODE_PREFIX',
      'KLTN',
    );
    const contentMatch = payload.content?.match(
      new RegExp(`${prefix}[0-9]{14}[A-Z0-9]{6}`),
    );
    if (contentMatch) {
      return contentMatch[0];
    }
    if (payload.code) {
      return payload.code;
    }
    return null;
  }

  private computeExpiresAt(): Date {
    const minutes = Number(
      this.configService.get<number>('PAYMENT_EXPIRE_MINUTES', 30),
    );

    return new Date(Date.now() + minutes * 60_000);
  }

  private toCheckoutResponse(
    transaction: PaymentTransaction,
  ): CheckoutResponse {
    const { bankAccount, bankHolder, bankCode } = this.getBankInfo();

    return {
      ...this.toTransactionResponse(transaction),
      bankAccount,
      bankHolder,
      bankCode,
      qrImageUrl: this.buildQrImageUrl(
        transaction.paymentCode,
        transaction.amount,
      ),
    };
  }

  private toTransactionResponse(
    transaction: PaymentTransaction,
  ): PaymentTransactionResponse {
    return {
      id: transaction.id,
      learnerId: transaction.learnerId,
      courseId: transaction.courseId,
      amount: transaction.amount,
      currency: transaction.currency,
      status: transaction.status,
      paymentCode: transaction.paymentCode,
      provider: transaction.provider,
      providerTransactionId: transaction.providerTransactionId,
      providerGateway: transaction.providerGateway,
      providerReferenceCode: transaction.providerReferenceCode,
      expiresAt: transaction.expiresAt,
      paidAt: transaction.paidAt,
      createdAt: transaction.createdAt,
    };
  }

  private getBankInfo(): {
    bankAccount: string;
    bankHolder: string;
    bankCode: string;
  } {
    return {
      bankAccount: this.configService.getOrThrow<string>('SEPAY_BANK_ACCOUNT'),
      bankHolder: this.configService.getOrThrow<string>('SEPAY_BANK_HOLDER'),
      bankCode: this.configService.getOrThrow<string>('SEPAY_BANK_CODE'),
    };
  }

  private buildQrImageUrl(paymentCode: string, amount: number): string {
    const { bankAccount, bankCode } = this.getBankInfo();
    const params = new URLSearchParams({
      acc: bankAccount,
      bank: bankCode,
      amount: String(amount),
      des: `${SE_PAY_MEMO_PREFIX} ${paymentCode}`,
    });

    return `${VIET_QR_URL}?${params.toString()}`;
  }
}
