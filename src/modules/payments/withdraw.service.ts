import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InstructorAccount } from '../users/entities/instructor-account.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { ConfigService as PaymentConfigService } from './config.service';
import {
  AdminWithdrawRequestItem,
  AdminWithdrawRequestListResponse,
  CancelWithdrawRequestDto,
  CreateWithdrawRequestDto,
  ListAdminWithdrawRequestsQueryDto,
  ListMyWithdrawRequestsQueryDto,
  RejectWithdrawRequestDto,
  WithdrawRequestListResponse,
  WithdrawRequestResponse,
} from './dto/withdraw.dto';
import {
  WithdrawRequest,
  WithdrawRequestStatus,
} from './entities/withdraw-request.entity';
import { InstructorBalanceService } from './instructor-balance.service';

@Injectable()
export class WithdrawService {
  constructor(
    @InjectRepository(WithdrawRequest)
    private readonly withdrawRepository: Repository<WithdrawRequest>,
    @InjectRepository(InstructorAccount)
    private readonly accountRepository: Repository<InstructorAccount>,
    private readonly paymentConfigService: PaymentConfigService,
    private readonly dataSource: DataSource,
    private readonly instructorBalanceService: InstructorBalanceService,
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
      createdAt: withdraw.createdAt,
      updatedAt: withdraw.updatedAt,
      instructor: {
        name: withdraw.instructor.name,
        email: withdraw.instructor.email,
      },
    };
  }
}
