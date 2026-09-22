import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { FREE_COURSE_PRICE } from '../../common/constants/course.constant';
import { CourseStatus } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { CartItem } from '../cart/entities/cart-item.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderStatus } from '../orders/entities/order-status.enum';
import { ConfigService as PaymentConfigService } from './config.service';
import {
  CheckoutResponse,
  LearnerPaymentTransactionItem,
  LearnerPaymentTransactionListResponse,
  ListLearnerPaymentTransactionsQueryDto,
  PaymentTransactionResponse,
  PaymentOrderItemResponse,
  SE_PAY_TRANSFER_IN,
  SePayWebhookPayload,
} from './dto/payment.dto';
import {
  AdminPaymentListResponse,
  ListAdminPaymentProviderEventsQueryDto,
  ListAdminPaymentTransactionsQueryDto,
} from './dto/admin-payment.dto';
import {
  PaymentAuditActorType,
  PaymentAuditActorTypeValue,
  PaymentAuditLog,
} from './entities/payment-audit.entity';
import {
  PaymentProviderEvent,
  PaymentProviderEventResult,
  PaymentProviderEventResultValue,
} from './entities/payment-provider-event.entity';
import {
  PaymentStatus,
  PaymentTransaction,
} from './entities/payment-transaction.entity';
import { InstructorBalanceService } from './instructor-balance.service';

const TRANSACTION_NOT_FOUND_ERROR = 'Payment transaction not found';
const PAYMENT_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const VIET_QR_URL = 'https://vietqr.app/img';
const SE_PAY_MEMO_PREFIX = 'SEVQR';
const DEFAULT_LEARNER_PAYMENT_PAGE = 1;
const DEFAULT_LEARNER_PAYMENT_LIMIT = 10;
const MAX_LEARNER_PAYMENT_LIMIT = 100;
const DEFAULT_ADMIN_PAYMENT_PAGE = 1;
const DEFAULT_ADMIN_PAYMENT_LIMIT = 10;
const MAX_ADMIN_PAYMENT_LIMIT = 100;

type PaymentConfirmationResult =
  | {
      confirmed: true;
      result: typeof PaymentProviderEventResult.PROCESSED_PAID;
      reason: null;
    }
  | {
      confirmed: false;
      result: typeof PaymentProviderEventResult.EXPIRED;
      reason: string;
    }
  | {
      confirmed: false;
      result: typeof PaymentProviderEventResult.DUPLICATE_PAYMENT;
      reason: string;
    };

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(PaymentTransaction)
    private readonly transactionsRepository: Repository<PaymentTransaction>,
    @InjectRepository(PaymentAuditLog)
    private readonly auditsRepository: Repository<PaymentAuditLog>,
    @InjectRepository(PaymentProviderEvent)
    private readonly providerEventsRepository: Repository<PaymentProviderEvent>,
    @InjectRepository(Enrollment)
    private readonly enrollmentsRepository: Repository<Enrollment>,
    private readonly notificationsService: NotificationsService,
    private readonly configService: NestConfigService,
    private readonly dataSource: DataSource,
    private readonly paymentConfigService: PaymentConfigService,
    private readonly instructorBalanceService: InstructorBalanceService,
  ) {}

  async createCartCheckout(learnerId: string): Promise<CheckoutResponse> {
    return this.dataSource.transaction(async (manager) => {
      const cartItems = await manager.getRepository(CartItem).find({
        where: { learnerId },
        relations: { course: { instructor: true } },
        order: { createdAt: 'ASC' },
      });

      if (cartItems.length === 0) {
        throw new BadRequestException('Giỏ hàng đang trống');
      }

      const enrollmentRepository = manager.getRepository(Enrollment);
      for (const item of cartItems) {
        const course = item.course;
        if (!course || course.status !== CourseStatus.PUBLISHED) {
          throw new BadRequestException(
            `Khóa học không còn khả dụng: ${item.courseId}`,
          );
        }
        if (course.price <= FREE_COURSE_PRICE) {
          throw new BadRequestException(
            `Khóa học miễn phí không thể thanh toán: ${course.title}`,
          );
        }
        const enrolled = await enrollmentRepository.exists({
          where: { learnerId, courseId: item.courseId },
        });
        if (enrolled) {
          throw new ConflictException(
            `Bạn đã đăng ký khóa học: ${course.title}`,
          );
        }
      }

      const totalAmount = cartItems.reduce(
        (total, item) => total + item.course.price,
        0,
      );
      const order = manager.getRepository(Order).create({
        learnerId,
        totalAmount,
        currency: 'VND',
        status: OrderStatus.PENDING,
        expiresAt: this.computeExpiresAt(),
        paidAt: null,
      });
      const savedOrder = await manager.getRepository(Order).save(order);
      const orderItems = await manager.getRepository(OrderItem).save(
        cartItems.map((item) =>
          manager.getRepository(OrderItem).create({
            orderId: savedOrder.id,
            courseId: item.courseId,
            instructorId: item.course.instructorId,
            unitPrice: item.course.price,
            createdAt: item.createdAt,
            course: item.course,
            instructor: item.course.instructor,
          }),
        ),
      );

      const paymentCode = await this.generateUniquePaymentCode();
      const transaction = manager.getRepository(PaymentTransaction).create({
        learnerId,
        orderId: savedOrder.id,
        amount: totalAmount,
        currency: 'VND',
        status: PaymentStatus.PENDING,
        paymentCode,
        provider: 'sepay',
        providerTransactionId: null,
        providerGateway: null,
        providerReferenceCode: null,
        expiresAt: savedOrder.expiresAt,
        paidAt: null,
        order: savedOrder,
      });
      const savedTransaction = await manager
        .getRepository(PaymentTransaction)
        .save(transaction);

      await manager.getRepository(PaymentAuditLog).save(
        manager.getRepository(PaymentAuditLog).create({
          transactionId: savedTransaction.id,
          actorType: PaymentAuditActorType.SYSTEM,
          actorId: null,
          fromStatus: null,
          toStatus: PaymentStatus.PENDING,
          amount: savedTransaction.amount,
          paymentCode: savedTransaction.paymentCode,
          providerTransactionId: null,
          reason: 'Cart checkout created',
        }),
      );

      await manager.getRepository(CartItem).remove(cartItems);

      savedTransaction.order = { ...savedOrder, items: orderItems };
      return this.toCheckoutResponse(savedTransaction);
    });
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
    if (saved.orderId) {
      const order = await this.dataSource.getRepository(Order).findOne({
        where: { id: saved.orderId },
      });
      if (order?.status === OrderStatus.PENDING) {
        order.status = OrderStatus.CANCELLED;
        await this.dataSource.getRepository(Order).save(order);
      }
    }
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

  async listLearnerTransactions(
    learnerId: string,
    query: ListLearnerPaymentTransactionsQueryDto,
  ): Promise<LearnerPaymentTransactionListResponse> {
    const page = this.normalizePage(query.page, DEFAULT_LEARNER_PAYMENT_PAGE);
    const limit = this.normalizeLimit(
      query.limit,
      DEFAULT_LEARNER_PAYMENT_LIMIT,
      MAX_LEARNER_PAYMENT_LIMIT,
    );
    const qb = this.transactionsRepository
      .createQueryBuilder('transaction')
      .leftJoinAndSelect('transaction.order', 'order')
      .leftJoinAndSelect('order.items', 'orderItem')
      .leftJoinAndSelect('orderItem.course', 'orderCourse')
      .where('transaction.learnerId = :learnerId', { learnerId })
      .orderBy('transaction.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (query.status) {
      qb.andWhere('transaction.status = :status', { status: query.status });
    }

    const [items, total] = await qb.getManyAndCount();

    return {
      items: items.map((transaction) =>
        this.toLearnerPaymentTransactionItem(transaction),
      ),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async listAdminTransactions(
    query: ListAdminPaymentTransactionsQueryDto,
  ): Promise<AdminPaymentListResponse<unknown>> {
    const page = this.normalizePage(query.page);
    const limit = this.normalizeLimit(query.limit);
    const qb = this.transactionsRepository
      .createQueryBuilder('transaction')
      .leftJoinAndSelect('transaction.learner', 'learner')
      .leftJoinAndSelect('transaction.order', 'order')
      .leftJoinAndSelect('order.items', 'orderItem')
      .leftJoinAndSelect('orderItem.course', 'orderCourse')
      .leftJoinAndSelect('orderItem.instructor', 'orderInstructor')
      .orderBy('transaction.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (query.status) {
      qb.andWhere('transaction.status = :status', { status: query.status });
    }
    if (query.dateFrom) {
      qb.andWhere('"transaction"."created_at" >= :dateFrom', {
        dateFrom: this.parseDateFromStartOfDay(query.dateFrom),
      });
    }
    if (query.dateTo) {
      qb.andWhere('"transaction"."created_at" <= :dateTo', {
        dateTo: this.parseDateToEndOfDay(query.dateTo),
      });
    }
    if (query.learnerId?.trim()) {
      qb.andWhere('"transaction"."learner_id"::text ILIKE :learnerId', {
        learnerId: `%${query.learnerId.trim()}%`,
      });
    }
    if (query.courseId?.trim()) {
      qb.andWhere('"orderItem"."course_id"::text ILIKE :courseId', {
        courseId: `%${query.courseId.trim()}%`,
      });
    }
    if (query.amountMin !== undefined) {
      qb.andWhere('transaction.amount >= :amountMin', {
        amountMin: query.amountMin,
      });
    }
    if (query.amountMax !== undefined) {
      qb.andWhere('transaction.amount <= :amountMax', {
        amountMax: query.amountMax,
      });
    }
    if (query.search?.trim()) {
      const search = `%${query.search.trim()}%`;
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where('"transaction"."id"::text ILIKE :search', { search })
            .orWhere('"transaction"."payment_code" ILIKE :search', { search })
            .orWhere('"transaction"."provider_transaction_id" ILIKE :search', {
              search,
            })
            .orWhere('"transaction"."learner_id"::text ILIKE :search', {
              search,
            })
            .orWhere('"orderItem"."course_id"::text ILIKE :search', {
              search,
            });
        }),
      );
    }

    const [items, total] = await qb.getManyAndCount();

    return {
      items: items.map((transaction) => ({
        id: transaction.id,
        learnerId: transaction.learnerId,
        orderId: transaction.orderId,
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
        updatedAt: transaction.updatedAt,
        learner: transaction.learner
          ? {
              id: transaction.learner.id,
              name: transaction.learner.name,
              email: transaction.learner.email,
            }
          : null,
        order: this.toOrderSummary(transaction.order),
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getAdminTransactionDetail(transactionId: string): Promise<unknown> {
    const transaction = await this.transactionsRepository.findOne({
      where: { id: transactionId },
      relations: {
        learner: true,
        order: { items: { course: true, instructor: true } },
      },
    });

    if (!transaction) {
      throw new NotFoundException(TRANSACTION_NOT_FOUND_ERROR);
    }

    const [audits, providerEvents] = await Promise.all([
      this.auditsRepository.find({
        where: { transactionId },
        order: { createdAt: 'DESC' },
      }),
      this.providerEventsRepository.find({
        where: { paymentTransactionId: transactionId },
        order: { receivedAt: 'DESC', createdAt: 'DESC' },
      }),
    ]);

    return {
      id: transaction.id,
      learnerId: transaction.learnerId,
      orderId: transaction.orderId ?? null,
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
      updatedAt: transaction.updatedAt,
      learner: transaction.learner
        ? {
            id: transaction.learner.id,
            name: transaction.learner.name,
            email: transaction.learner.email,
          }
        : null,
      order: this.toOrderSummary(transaction.order),
      audits: audits.map((audit) => ({
        id: audit.id,
        fromStatus: audit.fromStatus,
        toStatus: audit.toStatus,
        actorType: audit.actorType,
        actorId: audit.actorId,
        providerTransactionId: audit.providerTransactionId,
        reason: audit.reason,
        createdAt: audit.createdAt,
      })),
      providerEvents: providerEvents.map((event) => ({
        id: event.id,
        result: event.result,
        providerTransactionId: event.providerTransactionId,
        reportedPaymentCode: event.reportedPaymentCode,
        transferAmount: event.transferAmount,
        transferType: event.transferType,
        gateway: event.gateway,
        receivedAt: event.receivedAt,
        processedAt: event.processedAt,
      })),
    };
  }

  async listAdminProviderEvents(
    query: ListAdminPaymentProviderEventsQueryDto,
  ): Promise<AdminPaymentListResponse<unknown>> {
    const page = this.normalizePage(query.page);
    const limit = this.normalizeLimit(query.limit);
    const qb = this.providerEventsRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.paymentTransaction', 'transaction')
      .orderBy('event.receivedAt', 'DESC')
      .addOrderBy('event.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (query.result) {
      qb.andWhere('event.result = :result', { result: query.result });
    }
    if (query.dateFrom) {
      qb.andWhere('event.received_at >= :dateFrom', {
        dateFrom: this.parseDateFromStartOfDay(query.dateFrom),
      });
    }
    if (query.dateTo) {
      qb.andWhere('event.received_at <= :dateTo', {
        dateTo: this.parseDateToEndOfDay(query.dateTo),
      });
    }
    if (query.transferType) {
      qb.andWhere('event.transfer_type = :transferType', {
        transferType: query.transferType,
      });
    }
    if (query.paymentStatus) {
      qb.andWhere('"transaction"."status" = :paymentStatus', {
        paymentStatus: query.paymentStatus,
      });
    }
    if (query.gateway) {
      qb.andWhere('event.gateway = :gateway', { gateway: query.gateway });
    }
    if (query.search?.trim()) {
      const search = `%${query.search.trim()}%`;
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where('event.id::text ILIKE :search', { search })
            .orWhere('event.provider_transaction_id ILIKE :search', { search })
            .orWhere('event.reported_payment_code ILIKE :search', { search })
            .orWhere('event.provider_reference_code ILIKE :search', { search })
            .orWhere('event.payment_transaction_id::text ILIKE :search', {
              search,
            })
            .orWhere('"transaction"."payment_code" ILIKE :search', { search });
        }),
      );
    }

    const [items, total] = await qb.getManyAndCount();

    return {
      items: items.map((event) => ({
        id: event.id,
        provider: event.provider,
        providerTransactionId: event.providerTransactionId,
        paymentTransactionId: event.paymentTransactionId,
        reportedPaymentCode: event.reportedPaymentCode,
        transferAmount: event.transferAmount,
        transferType: event.transferType,
        gateway: event.gateway,
        providerReferenceCode: event.providerReferenceCode,
        result: event.result,
        reason: event.reason,
        receivedAt: event.receivedAt,
        processedAt: event.processedAt,
        createdAt: event.createdAt,
        paymentTransaction: event.paymentTransaction
          ? {
              id: event.paymentTransaction.id,
              paymentCode: event.paymentTransaction.paymentCode,
              status: event.paymentTransaction.status,
            }
          : null,
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getAdminProviderEventDetail(eventId: string): Promise<unknown> {
    const event = await this.providerEventsRepository.findOne({
      where: { id: eventId },
      relations: {
        paymentTransaction: {
          order: { items: { course: true, instructor: true } },
        },
      },
    });

    if (!event) {
      throw new NotFoundException('Payment provider event not found');
    }

    return {
      id: event.id,
      provider: event.provider,
      providerTransactionId: event.providerTransactionId,
      paymentTransactionId: event.paymentTransactionId,
      reportedPaymentCode: event.reportedPaymentCode,
      transferAmount: event.transferAmount,
      transferType: event.transferType,
      gateway: event.gateway,
      providerReferenceCode: event.providerReferenceCode,
      result: event.result,
      reason: event.reason,
      receivedAt: event.receivedAt,
      processedAt: event.processedAt,
      createdAt: event.createdAt,
      paymentTransaction: event.paymentTransaction
        ? {
            id: event.paymentTransaction.id,
            paymentCode: event.paymentTransaction.paymentCode,
            status: event.paymentTransaction.status,
            orderId: event.paymentTransaction.orderId,
            order: this.toOrderSummary(event.paymentTransaction.order),
            learnerId: event.paymentTransaction.learnerId,
            amount: event.paymentTransaction.amount,
            currency: event.paymentTransaction.currency,
          }
        : null,
    };
  }

  async processSePayWebhook(payload: SePayWebhookPayload): Promise<void> {
    const providerTransactionId = String(payload.id);
    const existingEvent = await this.providerEventsRepository.findOne({
      where: { providerTransactionId },
    });

    if (existingEvent) {
      return;
    }

    const providerEvent = this.buildProviderEvent(
      payload,
      providerTransactionId,
    );

    if (payload.transferType !== SE_PAY_TRANSFER_IN) {
      await this.saveProviderEventResult(
        providerEvent,
        PaymentProviderEventResult.IGNORED_TRANSFER_TYPE,
        `Ignored non-inbound transfer type: ${payload.transferType}`,
      );
      return;
    }

    const paymentCode = providerEvent.reportedPaymentCode;
    if (!paymentCode) {
      await this.saveProviderEventResult(
        providerEvent,
        PaymentProviderEventResult.UNKNOWN_PAYMENT_CODE,
        'No payment code found in SePay webhook payload',
      );
      return;
    }

    const alreadyProcessed = await this.transactionsRepository.findOne({
      where: { providerTransactionId },
    });
    if (alreadyProcessed) {
      return;
    }

    const transaction = await this.transactionsRepository.findOne({
      where: { paymentCode },
    });
    if (!transaction) {
      await this.saveProviderEventResult(
        providerEvent,
        PaymentProviderEventResult.UNKNOWN_PAYMENT_CODE,
        `No payment transaction found for payment code ${paymentCode}`,
      );
      return;
    }

    if (transaction.status === PaymentStatus.PAID) {
      await this.saveProviderEventResult(
        providerEvent,
        PaymentProviderEventResult.DUPLICATE_PAYMENT,
        'Payment transaction is already paid; manual reconciliation required',
        transaction,
      );
      return;
    }

    if (transaction.status === PaymentStatus.EXPIRED) {
      await this.saveProviderEventResult(
        providerEvent,
        PaymentProviderEventResult.EXPIRED,
        'Payment transaction is already expired; manual reconciliation required',
        transaction,
      );
      return;
    }

    if (transaction.status !== PaymentStatus.PENDING) {
      await this.saveProviderEventResult(
        providerEvent,
        PaymentProviderEventResult.DUPLICATE_PAYMENT,
        `Payment transaction is already ${transaction.status}; manual reconciliation required`,
        transaction,
      );
      return;
    }

    if (payload.transferAmount !== transaction.amount) {
      const reason = `Payment amount mismatch: expected=${transaction.amount}, received=${payload.transferAmount}`;
      await this.saveProviderEventResult(
        providerEvent,
        PaymentProviderEventResult.AMOUNT_MISMATCH,
        reason,
        transaction,
      );
      await this.failAmountMismatchTransaction(transaction, payload);
      return;
    }

    const confirmation = await this.confirmPaidTransactionAndEnroll(
      transaction,
      providerTransactionId,
      payload,
    );

    await this.saveProviderEventResult(
      providerEvent,
      confirmation.result,
      confirmation.reason,
      transaction,
    );

    if (confirmation.confirmed) {
      const notifiedTransaction = await this.transactionsRepository.findOne({
        where: { id: transaction.id },
        relations: { order: { items: true } },
      });
      await this.notifyPaymentSuccess(notifiedTransaction ?? transaction);
    }
  }

  private buildProviderEvent(
    payload: SePayWebhookPayload,
    providerTransactionId: string,
  ): PaymentProviderEvent {
    return this.providerEventsRepository.create({
      provider: 'sepay',
      providerTransactionId,
      paymentTransactionId: null,
      reportedPaymentCode: this.resolveSePayPaymentCode(payload),
      transferAmount: payload.transferAmount,
      transferType: payload.transferType,
      gateway: payload.gateway || null,
      providerReferenceCode: payload.referenceCode ?? null,
      result: null,
      reason: null,
      receivedAt: new Date(),
      processedAt: null,
    });
  }

  private normalizePage(
    value?: number,
    defaultPage = DEFAULT_ADMIN_PAYMENT_PAGE,
  ): number {
    return value && value > 0 ? value : defaultPage;
  }

  private normalizeLimit(
    value?: number,
    defaultLimit = DEFAULT_ADMIN_PAYMENT_LIMIT,
    maxLimit = MAX_ADMIN_PAYMENT_LIMIT,
  ): number {
    if (!value || value <= 0) return defaultLimit;

    return Math.min(value, maxLimit);
  }

  private parseDateFromStartOfDay(value: string): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T00:00:00.000Z`);
    }

    return new Date(value);
  }

  private parseDateToEndOfDay(value: string): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T23:59:59.999Z`);
    }

    return new Date(value);
  }

  private async saveProviderEventResult(
    event: PaymentProviderEvent,
    result: PaymentProviderEventResultValue,
    reason: string | null,
    transaction: PaymentTransaction | null = null,
  ): Promise<void> {
    event.paymentTransactionId = transaction?.id ?? null;
    event.result = result;
    event.reason = reason;
    event.processedAt = new Date();
    await this.providerEventsRepository.save(event);
  }

  private async failAmountMismatchTransaction(
    transaction: PaymentTransaction,
    payload: SePayWebhookPayload,
  ): Promise<void> {
    transaction.status = PaymentStatus.FAILED;
    transaction.providerTransactionId = String(payload.id);
    transaction.providerGateway = payload.gateway || null;
    transaction.providerReferenceCode = payload.referenceCode ?? null;
    transaction.paidAt = null;
    const saved = await this.transactionsRepository.save(transaction);
    if (saved.orderId) {
      const order = await this.dataSource.getRepository(Order).findOne({
        where: { id: saved.orderId },
      });
      if (order?.status === OrderStatus.PENDING) {
        order.status = OrderStatus.FAILED;
        await this.dataSource.getRepository(Order).save(order);
      }
    }
    await this.writeAudit(
      saved,
      PaymentAuditActorType.SEPAY,
      null,
      PaymentStatus.PENDING,
      PaymentStatus.FAILED,
      `Payment amount mismatch: expected=${transaction.amount}, received=${payload.transferAmount}`,
    );
  }

  private async confirmPaidTransactionAndEnroll(
    transaction: PaymentTransaction,
    providerTransactionId: string,
    payload: SePayWebhookPayload,
  ): Promise<PaymentConfirmationResult> {
    return this.dataSource.transaction(async (manager) => {
      const transactionsRepository = manager.getRepository(PaymentTransaction);
      const payment = await transactionsRepository.findOne({
        where: { id: transaction.id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!payment) {
        return {
          confirmed: false,
          result: PaymentProviderEventResult.DUPLICATE_PAYMENT,
          reason:
            'Payment transaction no longer exists; manual reconciliation required',
        };
      }

      if (payment.status === PaymentStatus.EXPIRED) {
        return {
          confirmed: false,
          result: PaymentProviderEventResult.EXPIRED,
          reason:
            'Payment transaction is already expired; manual reconciliation required',
        };
      }

      if (payment.status !== PaymentStatus.PENDING) {
        return {
          confirmed: false,
          result: PaymentProviderEventResult.DUPLICATE_PAYMENT,
          reason: `Payment transaction is already ${payment.status}; manual reconciliation required`,
        };
      }

      if (payment.expiresAt <= new Date()) {
        payment.status = PaymentStatus.EXPIRED;
        payment.providerTransactionId = providerTransactionId;
        payment.providerGateway = payload.gateway || null;
        payment.providerReferenceCode = payload.referenceCode ?? null;
        payment.paidAt = null;
        const saved = await transactionsRepository.save(payment);

        await manager.getRepository(PaymentAuditLog).save(
          manager.getRepository(PaymentAuditLog).create({
            transactionId: saved.id,
            actorType: PaymentAuditActorType.SEPAY,
            actorId: null,
            fromStatus: PaymentStatus.PENDING,
            toStatus: PaymentStatus.EXPIRED,
            amount: saved.amount,
            paymentCode: saved.paymentCode,
            providerTransactionId: saved.providerTransactionId,
            reason: 'Payment received after transaction expiry',
          }),
        );

        return {
          confirmed: false,
          result: PaymentProviderEventResult.EXPIRED,
          reason: 'Payment received after transaction expiry',
        };
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

      if (!saved.orderId) {
        throw new NotFoundException('Payment has no order for confirmation');
      }

      const order = await manager.getRepository(Order).findOne({
        where: { id: saved.orderId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!order) {
        throw new NotFoundException('Order not found for paid transaction');
      }

      order.items = await manager.getRepository(OrderItem).find({
        where: { orderId: order.id },
        relations: { course: true, instructor: true },
      });
      if (order.items.length === 0) {
        throw new NotFoundException('Order has no items for paid transaction');
      }

      order.status = OrderStatus.PAID;
      order.paidAt = saved.paidAt;
      await manager.getRepository(Order).save(order);

      const config = await this.paymentConfigService.getActiveConfig();
      const enrollmentsRepository = manager.getRepository(Enrollment);

      for (const item of order.items) {
        const platformFeeAmount = Math.round(
          (item.unitPrice * config.platformFeePercent) / 100,
        );
        const netAmount = item.unitPrice - platformFeeAmount;
        const paidAt = saved.paidAt ?? new Date();
        const availableAt = new Date(
          paidAt.getTime() + config.earningHoldDays * 24 * 60 * 60 * 1000,
        );

        await this.instructorBalanceService.recordEarningCredit({
          manager,
          payment: saved,
          course: item.course,
          orderItemId: item.id,
          grossAmount: item.unitPrice,
          platformFeeAmount,
          netAmount,
          availableAt,
        });

        const existing = await enrollmentsRepository.findOne({
          where: { learnerId: saved.learnerId, courseId: item.courseId },
        });
        if (!existing) {
          await enrollmentsRepository.save(
            enrollmentsRepository.create({
              learnerId: saved.learnerId,
              courseId: item.courseId,
              progress: '0.00',
              completedAt: null,
            }),
          );
        }
      }

      return {
        confirmed: true,
        result: PaymentProviderEventResult.PROCESSED_PAID,
        reason: null,
      };
    });
  }

  private async notifyPaymentSuccess(
    transaction: PaymentTransaction,
  ): Promise<void> {
    const orderItems = transaction.order?.items ?? [];
    const isMultiCourse = orderItems.length > 1;
    await this.notificationsService.createDirectNotification({
      userId: transaction.learnerId,
      title: 'Thanh toán thành công',
      message: isMultiCourse
        ? 'Bạn đã đăng ký các khóa học. Chúc bạn học tập vui vẻ!'
        : 'Bạn đã đăng ký khóa học. Chúc bạn học tập vui vẻ!',
      actionUrl: isMultiCourse
        ? '/learner/courses'
        : `/learner/courses/${orderItems[0]?.courseId}/learn`,
      metadata: {
        courseId: orderItems[0]?.courseId ?? null,
        transactionId: transaction.id,
        orderId: transaction.orderId,
      },
    });
  }

  private async assertOwner(
    learnerId: string,
    transactionId: string,
  ): Promise<PaymentTransaction> {
    const transaction = await this.transactionsRepository.findOne({
      where: { id: transactionId },
      relations: {
        order: { items: { course: true, instructor: true } },
      },
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
    if (saved.orderId) {
      const order = await this.dataSource.getRepository(Order).findOne({
        where: { id: saved.orderId },
      });
      if (order?.status === OrderStatus.PENDING) {
        order.status = OrderStatus.EXPIRED;
        await this.dataSource.getRepository(Order).save(order);
      }
    }
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
    if (!transaction.orderId) {
      throw new NotFoundException('Payment transaction has no order');
    }

    return {
      id: transaction.id,
      learnerId: transaction.learnerId,
      orderId: transaction.orderId,
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
      orderItems: transaction.order?.items
        ? this.toOrderItemResponses(transaction.order.items)
        : [],
    };
  }

  private toOrderSummary(order: Order | null | undefined) {
    return order
      ? {
          id: order.id,
          totalAmount: order.totalAmount,
          itemCount: order.items?.length ?? 0,
          items: (order.items ?? []).map((item) => ({
            courseId: item.courseId,
            courseTitle: item.course?.title ?? 'Khóa học không xác định',
            instructorName: item.instructor?.name ?? null,
            unitPrice: item.unitPrice,
          })),
        }
      : null;
  }

  private toOrderItemResponses(items: OrderItem[]): PaymentOrderItemResponse[] {
    return items.map((item) => ({
      id: item.id,
      courseId: item.courseId,
      courseTitle: item.course?.title ?? 'Khóa học không xác định',
      instructorName: item.instructor?.name ?? null,
      unitPrice: item.unitPrice,
    }));
  }

  private toLearnerPaymentTransactionItem(
    transaction: PaymentTransaction,
  ): LearnerPaymentTransactionItem {
    return {
      id: transaction.id,
      courseTitle:
        transaction.order?.items
          ?.map((item) => item.course?.title)
          .filter(Boolean)
          .join(', ') ?? 'Khóa học không xác định',
      amount: transaction.amount,
      status: transaction.status,
      createdAt: transaction.createdAt,
      paidAt: transaction.paidAt,
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
