import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { NotificationsQueueService } from '../notifications/notifications-queue.service';
import { InstructorAccount } from '../users/entities/instructor-account.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { ConfigService as PaymentConfigService } from './config.service';
import {
  AdminWithdrawRequestItem,
  AdminWithdrawRequestListResponse,
  AdminWithdrawPayoutResponse,
  CancelWithdrawRequestDto,
  CreateWithdrawRequestDto,
  ListAdminWithdrawRequestsQueryDto,
  ListMyWithdrawRequestsQueryDto,
  MarkWithdrawProcessedDto,
  RejectWithdrawRequestDto,
  WithdrawRequestListResponse,
  WithdrawRequestResponse,
} from './dto/withdraw.dto';
import {
  WithdrawRequest,
  WithdrawRequestStatus,
} from './entities/withdraw-request.entity';
import { InstructorBalanceService } from './instructor-balance.service';

const VIETQR_IMAGE_URL = 'https://vietqr.app/img';
const PAYOUT_STORE_NAME = 'KLTN LMS';

@Injectable()
export class WithdrawService {
  private readonly logger = new Logger(WithdrawService.name);

  constructor(
    @InjectRepository(WithdrawRequest)
    private readonly withdrawRepository: Repository<WithdrawRequest>,
    @InjectRepository(InstructorAccount)
    private readonly accountRepository: Repository<InstructorAccount>,
    private readonly paymentConfigService: PaymentConfigService,
    private readonly dataSource: DataSource,
    private readonly instructorBalanceService: InstructorBalanceService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly notificationsQueueService: NotificationsQueueService,
  ) {}

  async create(
    currentUser: Pick<User, 'id' | 'role'>,
    dto: CreateWithdrawRequestDto,
  ): Promise<WithdrawRequestResponse> {
    this.assertInstructor(currentUser);

    const [config, account] = await Promise.all([
      this.paymentConfigService.getActiveConfig(),
      this.accountRepository.findOne({
        where: { instructorId: currentUser.id },
      }),
    ]);

    if (!account) {
      throw new BadRequestException('Instructor payout account is required');
    }

    if (dto.amount < config.minimumWithdrawalAmount) {
      throw new BadRequestException({
        message: 'Amount is below minimum withdrawal amount',
        details: [
          `minimumWithdrawalAmount=${config.minimumWithdrawalAmount}`,
          `currency=${config.currency}`,
        ],
      });
    }

    const balance = await this.instructorBalanceService.getSummary(currentUser);

    if (dto.amount > balance.withdrawableBalance) {
      throw new BadRequestException({
        message: 'Amount exceeds withdrawable balance',
        details: [
          `withdrawableBalance=${balance.withdrawableBalance}`,
          `currency=${balance.currency}`,
        ],
      });
    }

    const withdraw = this.withdrawRepository.create({
      instructorId: currentUser.id,
      amount: dto.amount,
      currency: config.currency,
      status: WithdrawRequestStatus.PENDING,
      requestedAt: new Date(),
      note: this.normalizeNote(dto.note),
    });
    const saved = await this.withdrawRepository.save(withdraw);
    await this.notifyWithdrawalSubmitted(saved);

    return this.toResponse(saved);
  }

  async listMine(
    currentUser: Pick<User, 'id' | 'role'>,
    query: ListMyWithdrawRequestsQueryDto,
  ): Promise<WithdrawRequestListResponse> {
    this.assertInstructor(currentUser);

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const [items, total] = await this.withdrawRepository
      .createQueryBuilder('withdraw')
      .where('withdraw.instructorId = :instructorId', {
        instructorId: currentUser.id,
      })
      .orderBy('withdraw.requestedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items: items.map((item) => this.toResponse(item)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async listAdmin(
    query: ListAdminWithdrawRequestsQueryDto,
  ): Promise<AdminWithdrawRequestListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const amountSort = query.amountSort ?? 'desc';
    const qb = this.withdrawRepository
      .createQueryBuilder('withdraw')
      .leftJoinAndSelect('withdraw.instructor', 'instructor')
      .where('1 = 1');

    if (query.status) {
      qb.andWhere('withdraw.status = :status', { status: query.status });
    }

    if (query.instructorEmail?.trim()) {
      qb.andWhere('LOWER(instructor.email) LIKE :instructorEmail', {
        instructorEmail: `%${query.instructorEmail.trim().toLowerCase()}%`,
      });
    }

    if (query.requestedAtFrom) {
      qb.andWhere('withdraw.requestedAt >= :requestedAtFrom', {
        requestedAtFrom: new Date(query.requestedAtFrom),
      });
    }

    if (query.requestedAtTo) {
      qb.andWhere('withdraw.requestedAt <= :requestedAtTo', {
        requestedAtTo: new Date(query.requestedAtTo),
      });
    }

    const [items, total] = await qb
      .orderBy('withdraw.requestedAt', 'DESC')
      .addOrderBy('withdraw.amount', amountSort === 'asc' ? 'ASC' : 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items: items.map((item) => this.toAdminResponse(item)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async cancel(
    currentUser: Pick<User, 'id' | 'role'>,
    id: string,
    dto: CancelWithdrawRequestDto,
  ): Promise<WithdrawRequestResponse> {
    this.assertInstructor(currentUser);

    const updateResult = await this.withdrawRepository.update(
      {
        id,
        instructorId: currentUser.id,
        status: WithdrawRequestStatus.PENDING,
      },
      {
        status: WithdrawRequestStatus.CANCELLED,
        cancelReason: this.normalizeNote(dto.reason),
        cancelledAt: new Date(),
      },
    );

    if (!updateResult.affected) {
      const existing = await this.withdrawRepository.findOne({ where: { id } });

      if (!existing) {
        throw new NotFoundException('Withdraw request not found');
      }

      if (existing.instructorId !== currentUser.id) {
        throw new ForbiddenException(
          'Cannot cancel another instructor request',
        );
      }

      throw new BadRequestException(
        'Only pending withdraw requests can be cancelled',
      );
    }

    const saved = await this.withdrawRepository.findOne({ where: { id } });

    if (!saved) {
      throw new NotFoundException('Withdraw request not found');
    }

    return this.toResponse(saved);
  }

  async reject(
    id: string,
    dto: RejectWithdrawRequestDto,
  ): Promise<AdminWithdrawRequestItem> {
    const updateResult = await this.withdrawRepository.update(
      { id, status: WithdrawRequestStatus.PENDING },
      {
        status: WithdrawRequestStatus.REJECTED,
        rejectReason: this.normalizeNote(dto.reason),
        rejectedAt: new Date(),
      },
    );

    if (!updateResult.affected) {
      const existing = await this.withdrawRepository.findOne({ where: { id } });

      if (!existing) {
        throw new NotFoundException('Withdraw request not found');
      }

      throw new BadRequestException(
        'Only pending withdraw requests can be rejected',
      );
    }

    const saved = await this.withdrawRepository.findOne({
      where: { id },
      relations: { instructor: true },
    });

    if (!saved) {
      throw new NotFoundException('Withdraw request not found');
    }

    this.notifyWithdrawalStatusChanged(saved);

    return this.toAdminResponse(saved);
  }

  async process(id: string): Promise<AdminWithdrawPayoutResponse> {
    const withdraw = await this.withdrawRepository.findOne({
      where: { id },
      relations: { instructor: true },
    });

    if (!withdraw) {
      throw new NotFoundException('Withdraw request not found');
    }

    if (withdraw.status === WithdrawRequestStatus.PROCESSING) {
      return this.toPayoutResponse(
        withdraw,
        await this.getValidPayoutAccount(withdraw.instructorId),
      );
    }

    if (withdraw.status !== WithdrawRequestStatus.PENDING) {
      throw new BadRequestException(
        'Only pending withdraw requests can start processing',
      );
    }

    const account = await this.getValidPayoutAccount(withdraw.instructorId);
    const payoutDescription = this.buildPayoutDescription(withdraw.id);
    const updateResult = await this.withdrawRepository.update(
      { id, status: WithdrawRequestStatus.PENDING },
      {
        status: WithdrawRequestStatus.PROCESSING,
        processingAt: new Date(),
        payoutDescription,
      },
    );

    if (!updateResult.affected) {
      throw new BadRequestException(
        'Only pending withdraw requests can start processing',
      );
    }

    const saved = await this.withdrawRepository.findOne({
      where: { id },
      relations: { instructor: true },
    });

    if (!saved) {
      throw new NotFoundException('Withdraw request not found');
    }

    this.notifyWithdrawalStatusChanged(saved);

    return this.toPayoutResponse(saved, account);
  }

  async markProcessed(
    id: string,
    dto: MarkWithdrawProcessedDto,
  ): Promise<AdminWithdrawRequestItem> {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(WithdrawRequest);
      const withdraw = await repo.findOne({ where: { id } });

      if (!withdraw) {
        throw new NotFoundException('Withdraw request not found');
      }

      if (withdraw.status !== WithdrawRequestStatus.PROCESSING) {
        throw new BadRequestException(
          'Only processing withdraw requests can be marked processed',
        );
      }

      withdraw.status = WithdrawRequestStatus.PROCESSED;
      withdraw.processedAt = new Date();
      withdraw.payoutReference = this.normalizeNote(dto.payoutReference);

      const saved = await repo.save(withdraw);
      await this.instructorBalanceService.recordWithdrawDebit(manager, saved);
    });

    const saved = await this.withdrawRepository.findOne({
      where: { id },
      relations: { instructor: true },
    });

    if (!saved) {
      throw new NotFoundException('Withdraw request not found');
    }

    this.notifyWithdrawalStatusChanged(saved);

    return this.toAdminResponse(saved);
  }

  async recordProcessedDebit(id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const withdraw = await manager.getRepository(WithdrawRequest).findOne({
        where: { id },
      });

      if (!withdraw) {
        throw new NotFoundException('Withdraw request not found');
      }

      if (withdraw.status !== WithdrawRequestStatus.PROCESSED) {
        throw new BadRequestException(
          'Only processed withdraw requests can create balance debit entries',
        );
      }

      await this.instructorBalanceService.recordWithdrawDebit(
        manager,
        withdraw,
      );
    });
  }

  private assertInstructor(currentUser: Pick<User, 'role'>): void {
    if (currentUser.role !== UserRole.INSTRUCTOR) {
      throw new BadRequestException('User is not an instructor');
    }
  }

  private normalizeNote(note?: string): string | null {
    const normalized = note?.trim();

    return normalized ? normalized : null;
  }

  private async getValidPayoutAccount(
    instructorId: string,
  ): Promise<InstructorAccount> {
    const account = await this.accountRepository.findOne({
      where: { instructorId },
    });

    if (!account) {
      throw new BadRequestException('Instructor payout account is required');
    }

    if (
      !account.bankCode?.trim() ||
      !account.bankAccountNumber.trim() ||
      !account.accountHolderName.trim()
    ) {
      throw new BadRequestException('Instructor payout account is incomplete');
    }

    return account;
  }

  private buildPayoutDescription(id: string): string {
    return `PAYOUT-WD-${id.slice(0, 8)}`;
  }

  private async notifyWithdrawalSubmitted(
    withdraw: WithdrawRequest,
  ): Promise<void> {
    try {
      const admins = await this.usersRepository.find({
        where: { role: UserRole.ADMIN },
      });

      for (const admin of admins) {
        this.notificationsQueueService.enqueueCreateNotification({
          kind: 'direct',
          targetUserId: admin.id,
          title: 'Yêu cầu rút tiền mới',
          message: `Giảng viên đã gửi yêu cầu rút ${withdraw.amount.toLocaleString('vi-VN')} ${withdraw.currency}.`,
          actionUrl: '/admin/withdrawals',
          metadata: {
            withdrawRequestId: withdraw.id,
            instructorId: withdraw.instructorId,
            amount: withdraw.amount,
            currency: withdraw.currency,
            status: withdraw.status,
            requestedAt: withdraw.requestedAt,
          },
          sentAt: new Date().toISOString(),
          triggerKey: `withdraw-submitted:${withdraw.id}`,
          triggerDate: this.getNotificationTriggerDate(),
        });
      }
    } catch (error) {
      this.logger.error(
        'Could not enqueue withdrawal submitted notifications',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private notifyWithdrawalStatusChanged(withdraw: WithdrawRequest): void {
    try {
      this.notificationsQueueService.enqueueCreateNotification({
        kind: 'direct',
        targetUserId: withdraw.instructorId,
        title: this.getWithdrawalStatusNotificationTitle(withdraw.status),
        message: this.getWithdrawalStatusNotificationMessage(withdraw),
        actionUrl: '/instructor/withdrawals',
        metadata: {
          withdrawRequestId: withdraw.id,
          instructorId: withdraw.instructorId,
          amount: withdraw.amount,
          currency: withdraw.currency,
          status: withdraw.status,
          reason: withdraw.rejectReason,
          payoutDescription: withdraw.payoutDescription,
          payoutReference: withdraw.payoutReference,
        },
        sentAt: new Date().toISOString(),
        triggerKey: `withdraw-status:${withdraw.id}:${withdraw.status}`,
        triggerDate: this.getNotificationTriggerDate(),
      });
    } catch (error) {
      this.logger.error(
        'Could not enqueue withdrawal status notification',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private getWithdrawalStatusNotificationTitle(
    status: WithdrawRequestStatus,
  ): string {
    if (status === WithdrawRequestStatus.PROCESSING) {
      return 'Yêu cầu rút tiền đang được xử lý';
    }

    if (status === WithdrawRequestStatus.PROCESSED) {
      return 'Yêu cầu rút tiền đã được thanh toán';
    }

    if (status === WithdrawRequestStatus.REJECTED) {
      return 'Yêu cầu rút tiền bị từ chối';
    }

    return 'Cập nhật yêu cầu rút tiền';
  }

  private getWithdrawalStatusNotificationMessage(
    withdraw: WithdrawRequest,
  ): string {
    if (withdraw.status === WithdrawRequestStatus.PROCESSING) {
      return 'Admin đã bắt đầu xử lý yêu cầu rút tiền của bạn.';
    }

    if (withdraw.status === WithdrawRequestStatus.PROCESSED) {
      return 'Yêu cầu rút tiền của bạn đã được ghi nhận là đã thanh toán.';
    }

    if (withdraw.status === WithdrawRequestStatus.REJECTED) {
      return withdraw.rejectReason
        ? `Yêu cầu rút tiền của bạn bị từ chối: ${withdraw.rejectReason}`
        : 'Yêu cầu rút tiền của bạn bị từ chối.';
    }

    return 'Yêu cầu rút tiền của bạn đã được cập nhật.';
  }

  private getNotificationTriggerDate(date = new Date()): string {
    return date.toISOString().slice(0, 10);
  }

  private buildVietQrUrl(
    withdraw: WithdrawRequest,
    account: InstructorAccount,
  ): string {
    const params = new URLSearchParams({
      acc: account.bankAccountNumber,
      bank: account.bankCode ?? '',
      amount: String(withdraw.amount),
      des:
        withdraw.payoutDescription ?? this.buildPayoutDescription(withdraw.id),
      template: 'compact',
      showinfo: 'true',
      fullacc: 'true',
      holder: account.accountHolderName,
      store: PAYOUT_STORE_NAME,
    });

    return `${VIETQR_IMAGE_URL}?${params.toString()}`;
  }

  private toResponse(withdraw: WithdrawRequest): WithdrawRequestResponse {
    return {
      id: withdraw.id,
      instructorId: withdraw.instructorId,
      amount: withdraw.amount,
      currency: withdraw.currency,
      status: withdraw.status,
      requestedAt: withdraw.requestedAt,
      note: withdraw.note,
      cancelReason: withdraw.cancelReason,
      cancelledAt: withdraw.cancelledAt,
      rejectReason: withdraw.rejectReason,
      rejectedAt: withdraw.rejectedAt,
      processingAt: withdraw.processingAt,
      processedAt: withdraw.processedAt,
      payoutReference: withdraw.payoutReference,
      payoutDescription: withdraw.payoutDescription,
      createdAt: withdraw.createdAt,
      updatedAt: withdraw.updatedAt,
    };
  }

  private toAdminResponse(withdraw: WithdrawRequest): AdminWithdrawRequestItem {
    return {
      id: withdraw.id,
      amount: withdraw.amount,
      currency: withdraw.currency,
      status: withdraw.status,
      requestedAt: withdraw.requestedAt,
      note: withdraw.note,
      cancelReason: withdraw.cancelReason,
      cancelledAt: withdraw.cancelledAt,
      rejectReason: withdraw.rejectReason,
      rejectedAt: withdraw.rejectedAt,
      processingAt: withdraw.processingAt,
      processedAt: withdraw.processedAt,
      payoutReference: withdraw.payoutReference,
      payoutDescription: withdraw.payoutDescription,
      createdAt: withdraw.createdAt,
      updatedAt: withdraw.updatedAt,
      instructor: {
        name: withdraw.instructor.name,
        email: withdraw.instructor.email,
      },
    };
  }

  private toPayoutResponse(
    withdraw: WithdrawRequest,
    account: InstructorAccount,
  ): AdminWithdrawPayoutResponse {
    return {
      ...this.toAdminResponse(withdraw),
      payoutDescription:
        withdraw.payoutDescription ?? this.buildPayoutDescription(withdraw.id),
      qrImageUrl: this.buildVietQrUrl(withdraw, account),
      payoutAccount: {
        bankName: account.bankName,
        bankCode: account.bankCode ?? '',
        bankAccountNumber: account.bankAccountNumber,
        accountHolderName: account.accountHolderName,
      },
    };
  }
}
