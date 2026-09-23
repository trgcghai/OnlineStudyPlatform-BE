import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import type { Client as MinioClient } from 'minio';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';
import { REFRESH_SESSION_KEY_PREFIX } from '../../common/constants/auth.constant';
import { MINIO_CLIENT } from '../../common/constants/file.constant';
import { REDIS_CLIENT } from '../redis/redis.module';
import {
  ADMIN_ASSIGNABLE_ROLES,
  AdminListUsersQueryDto,
  AdminUserListResult,
  CreateAdminUserDto,
  UpdateAdminUserDto,
} from './dto/admin-user.dto';
import {
  ChangePasswordDto,
  CreateUserDto,
  UpdateProfileDto,
  UserResponse,
} from './dto/user.dto';
import {
  InstructorAccountResponse,
  UpsertInstructorAccountDto,
} from './dto/instructor-account.dto';
import { InstructorAccount } from './entities/instructor-account.entity';
import { User, UserRole, UserStatus } from './entities/user.entity';
import {
  normalizeVietQrBankResponse,
  validateBankOptions,
} from '../../common/utils/bank-catalog.util';
import {
  BankCatalog,
  BankCatalogDocument,
  BankOption,
} from './schemas/bank-catalog.schema';

const BCRYPT_SALT_ROUNDS = 10;
const VIETQR_BANKS_URL = 'https://vietqr.app/banks.json';
const BANK_CATALOG_SOURCE = 'vietqr';

@Injectable()
export class UsersService {
  private bankCache: BankOption[] | null = null;
  private pendingVerificationStatusEnsured = false;

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(InstructorAccount)
    private readonly instructorAccountsRepository: Repository<InstructorAccount>,
    private readonly configService: ConfigService,
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectModel(BankCatalog.name)
    private readonly bankCatalogModel: Model<BankCatalogDocument>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOneBy({
      email: email.trim().toLowerCase(),
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ id });
  }

  async listBanks(): Promise<BankOption[]> {
    if (this.bankCache) return [...this.bankCache];

    try {
      const banks = await this.fetchVietQrBanks();
      this.bankCache = banks;
      await this.upsertBankCatalog(banks);

      return [...banks];
    } catch {
      const banks = await this.loadBankCatalogFallback();
      this.bankCache = banks;

      return [...banks];
    }
  }

  async create(
    createUserDto: CreateUserDto,
    options?: { role?: UserRole; status?: UserStatus },
  ): Promise<UserResponse> {
    const { name, email, password } = createUserDto;
    if (
      await this.usersRepository.findOneBy({
        email: email.trim().toLowerCase(),
      })
    ) {
      throw new ConflictException('Email already registered');
    }

    try {
      const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
      const status = options?.status ?? UserStatus.PENDING_VERIFICATION;

      if (status === UserStatus.PENDING_VERIFICATION) {
        await this.ensurePendingVerificationStatusAvailable();
      }

      const user = this.usersRepository.create({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password: hashedPassword,
        role: options?.role ?? UserRole.LEARNER,
        status,
      });

      const savedUser = await this.usersRepository.save(user);
      return this.toUserResponse(savedUser);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      const persistenceError = error as { code?: unknown };
      if (persistenceError.code === '23505') {
        throw new ConflictException('Email already registered');
      }

      throw new InternalServerErrorException('Could not create user');
    }
  }

  async createAsAdmin(dto: CreateAdminUserDto): Promise<UserResponse> {
    return this.create(dto, { role: dto.role, status: UserStatus.ACTIVE });
  }

  private async ensurePendingVerificationStatusAvailable(): Promise<void> {
    if (this.pendingVerificationStatusEnsured) {
      return;
    }

    try {
      await this.usersRepository.query(
        `ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS '${UserStatus.PENDING_VERIFICATION}'`,
      );
      this.pendingVerificationStatusEnsured = true;
    } catch {
      // Non-PostgreSQL tests or fresh schemas may not need manual enum updates.
      // The following save will still surface a persistence error if the value is unsupported.
    }
  }

  async activatePendingUserByEmail(email: string): Promise<UserResponse> {
    const user = await this.findByEmail(email);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status === UserStatus.ACTIVE) {
      return this.toUserResponse(user);
    }

    if (user.status !== UserStatus.PENDING_VERIFICATION) {
      throw new ForbiddenException('Account disabled');
    }

    user.status = UserStatus.ACTIVE;
    const savedUser = await this.usersRepository.save(user);

    return this.toUserResponse(savedUser);
  }

  async findAllForAdmin(
    query: AdminListUsersQueryDto,
  ): Promise<AdminUserListResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const qb = this.usersRepository
      .createQueryBuilder('user')
      .where('user.role IN (:...roles)', { roles: ADMIN_ASSIGNABLE_ROLES });

    if (query.role) {
      qb.andWhere('user.role = :role', { role: query.role });
    }

    if (query.status) {
      qb.andWhere('user.status = :status', { status: query.status });
    }

    if (query.q) {
      qb.andWhere('(user.name ILIKE :search OR user.email ILIKE :search)', {
        search: `%${query.q}%`,
      });
    }

    qb.orderBy('user.createdAt', 'DESC');

    const total = await qb.getCount();
    const users = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return {
      items: users.map((user) => this.toUserResponse(user)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async updateAsAdmin(
    id: string,
    dto: UpdateAdminUserDto,
  ): Promise<UserResponse> {
    const hasChanges = Boolean(
      dto.name !== undefined ||
      dto.email !== undefined ||
      dto.password !== undefined ||
      dto.role !== undefined ||
      dto.status !== undefined,
    );

    if (!hasChanges) {
      throw new BadRequestException('No changes provided');
    }

    const user = await this.usersRepository.findOneBy({ id });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!ADMIN_ASSIGNABLE_ROLES.includes(user.role)) {
      throw new ForbiddenException('Admin accounts cannot be managed here');
    }

    if (
      dto.email !== undefined &&
      dto.email !== user.email &&
      (await this.usersRepository.findOneBy({ email: dto.email }))
    ) {
      throw new ConflictException('Email already registered');
    }

    if (dto.name !== undefined) {
      user.name = dto.name.trim();
    }

    if (dto.email !== undefined) {
      user.email = dto.email;
    }

    if (dto.role !== undefined) {
      user.role = dto.role;
    }

    if (dto.status !== undefined) {
      user.status = dto.status;
    }

    if (dto.password !== undefined) {
      user.password = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);
    }

    try {
      const savedUser = await this.usersRepository.save(user);
      return this.toUserResponse(savedUser);
    } catch (error) {
      const persistenceError = error as { code?: unknown };
      if (persistenceError.code === '23505') {
        throw new ConflictException('Email already registered');
      }

      throw new InternalServerErrorException('Could not update user');
    }
  }

  async disableUser(id: string): Promise<UserResponse> {
    const user = await this.usersRepository.findOneBy({ id });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!ADMIN_ASSIGNABLE_ROLES.includes(user.role)) {
      throw new ForbiddenException('Admin accounts cannot be managed here');
    }

    if (user.status === UserStatus.INACTIVE) {
      return this.toUserResponse(user);
    }

    user.status = UserStatus.INACTIVE;
    const savedUser = await this.usersRepository.save(user);
    await this.revokeRefreshSessionsQuietly(user.id);

    return this.toUserResponse(savedUser);
  }

  async getProfile(userId: string): Promise<UserResponse> {
    const user = await this.usersRepository.findOneBy({ id: userId });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.toUserResponse(user);
  }

  async updateProfile(
    userId: string,
    updateProfileDto: UpdateProfileDto,
  ): Promise<UserResponse> {
    const user = await this.usersRepository.findOneBy({ id: userId });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const { name } = updateProfileDto;

    let hasChanges = false;

    if (typeof name === 'string' && name.trim().length > 0) {
      user.name = name.trim();
      hasChanges = true;
    }

    if (!hasChanges) {
      return this.toUserResponse(user);
    }

    const savedUser = await this.usersRepository.save(user);
    return this.toUserResponse(savedUser);
  }

  async getMyInstructorAccount(
    instructorId: string,
  ): Promise<InstructorAccountResponse | null> {
    const account = await this.instructorAccountsRepository.findOne({
      where: { instructorId },
    });

    return account ? this.toInstructorAccountResponse(account) : null;
  }

  async upsertMyInstructorAccount(
    instructorId: string,
    dto: UpsertInstructorAccountDto,
  ): Promise<InstructorAccountResponse> {
    const existing = await this.instructorAccountsRepository.findOne({
      where: { instructorId },
    });
    const normalized = await this.normalizeInstructorAccountDto(dto);
    const account =
      existing ?? this.instructorAccountsRepository.create({ instructorId });

    Object.assign(account, normalized);

    const saved = await this.instructorAccountsRepository.save(account);
    return this.toInstructorAccountResponse(saved);
  }

  async getInstructorAccountForAdmin(
    instructorId: string,
  ): Promise<InstructorAccountResponse | null> {
    const instructor = await this.usersRepository.findOneBy({
      id: instructorId,
    });

    if (!instructor || instructor.role !== UserRole.INSTRUCTOR) {
      throw new NotFoundException('Instructor not found');
    }

    return this.getMyInstructorAccount(instructorId);
  }

  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.usersRepository.findOneBy({ id: userId });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      changePasswordDto.currentPassword,
      user.password,
    );

    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    user.password = await bcrypt.hash(
      changePasswordDto.newPassword,
      BCRYPT_SALT_ROUNDS,
    );
    await this.usersRepository.save(user);
  }

  async resetPasswordById(userId: string, newPassword: string): Promise<void> {
    const user = await this.usersRepository.findOneBy({ id: userId });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Account disabled');
    }

    user.password = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await this.usersRepository.save(user);
  }

  async uploadAvatar(
    userId: string,
    file: Express.Multer.File,
  ): Promise<UserResponse> {
    const user = await this.usersRepository.findOneBy({ id: userId });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const bucket = this.configService.getOrThrow<string>('MINIO_BUCKET');
    const endpoint = this.configService.getOrThrow<string>('MINIO_ENDPOINT');
    const objectKey = this.buildAvatarObjectKey(userId, file);

    try {
      await this.minioClient.putObject(
        bucket,
        objectKey,
        file.buffer,
        file.size,
        {
          contentType: file.mimetype,
        },
      );
    } catch {
      throw new InternalServerErrorException('Could not upload avatar');
    }

    const previousAvatar = user.avatar;
    user.avatar = this.buildPublicObjectUrl(endpoint, bucket, objectKey);
    const savedUser = await this.usersRepository.save(user);

    if (previousAvatar) {
      await this.deleteAvatarObjectQuietly(endpoint, bucket, previousAvatar);
    }

    return this.toUserResponse(savedUser);
  }

  private buildAvatarObjectKey(
    userId: string,
    file: Express.Multer.File,
  ): string {
    const extension = this.extractImageExtension(
      file.originalname,
      file.mimetype,
    );

    return `avatars/${userId}/${randomUUID()}${extension}`;
  }

  private extractImageExtension(
    originalName: string,
    mimetype: string,
  ): string {
    const extensionFromName = originalName.includes('.')
      ? originalName.slice(originalName.lastIndexOf('.')).toLowerCase()
      : '';

    if (/^\.[a-z0-9]{1,5}$/.test(extensionFromName)) {
      return extensionFromName;
    }

    const mimeExtensions: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
    };

    return mimeExtensions[mimetype] ?? '';
  }

  private buildPublicObjectUrl(
    endpoint: string,
    bucket: string,
    objectKey: string,
  ): string {
    return `${endpoint.replace(/\/+$/, '')}/${bucket}/${objectKey}`;
  }

  private getObjectKeyFromPublicUrl(
    endpoint: string,
    bucket: string,
    publicUrl: string,
  ): string | null {
    const prefix = this.buildPublicObjectUrl(endpoint, bucket, '');

    return publicUrl.startsWith(prefix) ? publicUrl.slice(prefix.length) : null;
  }

  private async deleteAvatarObjectQuietly(
    endpoint: string,
    bucket: string,
    publicUrl: string,
  ): Promise<void> {
    const objectKey = this.getObjectKeyFromPublicUrl(
      endpoint,
      bucket,
      publicUrl,
    );

    if (!objectKey) {
      return;
    }

    try {
      await this.minioClient.removeObject(bucket, objectKey);
    } catch {
      // Best-effort cleanup; a stale avatar object must not fail the request.
    }
  }

  private async revokeRefreshSessionsQuietly(userId: string): Promise<void> {
    try {
      const keys = await this.redis.keys(
        `${REFRESH_SESSION_KEY_PREFIX}:${userId}:*`,
      );

      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch {
      // Best-effort cleanup; login/refresh are already blocked by user status.
    }
  }

  private async normalizeInstructorAccountDto(dto: UpsertInstructorAccountDto) {
    const bankCode = dto.bankCode.trim();
    const bank = (await this.listBanks()).find(
      (item) => item.code === bankCode,
    );

    if (!bank) {
      throw new BadRequestException('Bank code is not supported');
    }

    return {
      bankName: bank.name,
      bankAccountNumber: dto.bankAccountNumber.trim(),
      accountHolderName: dto.accountHolderName.trim(),
      bankCode,
      branchName: this.optionalAccountField(dto.branchName),
      phoneNumber: this.optionalAccountField(dto.phoneNumber),
      note: this.optionalAccountField(dto.note),
    };
  }

  private async fetchVietQrBanks(): Promise<BankOption[]> {
    const response = await fetch(VIETQR_BANKS_URL);
    if (!response.ok) {
      throw new Error(`VietQR bank fetch failed: ${response.status}`);
    }

    return normalizeVietQrBankResponse(await response.json());
  }

  private async upsertBankCatalog(banks: BankOption[]): Promise<void> {
    await this.bankCatalogModel
      .findOneAndUpdate(
        { source: BANK_CATALOG_SOURCE },
        { source: BANK_CATALOG_SOURCE, banks, fetchedAt: new Date() },
        { upsert: true, new: true },
      )
      .exec();
  }

  private async loadBankCatalogFallback(): Promise<BankOption[]> {
    const fallback = await this.bankCatalogModel
      .findOne({ source: BANK_CATALOG_SOURCE })
      .exec();

    if (!fallback) {
      throw new ServiceUnavailableException('Bank list is not available');
    }

    return validateBankOptions(fallback.banks);
  }

  private optionalAccountField(
    value: string | null | undefined,
  ): string | null {
    if (value === null || value === undefined) return null;

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toInstructorAccountResponse(
    account: InstructorAccount,
  ): InstructorAccountResponse {
    return {
      id: account.id,
      instructorId: account.instructorId,
      bankName: account.bankName,
      bankAccountNumber: account.bankAccountNumber,
      accountHolderName: account.accountHolderName,
      bankCode: account.bankCode,
      branchName: account.branchName,
      phoneNumber: account.phoneNumber,
      note: account.note,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }

  private toUserResponse(user: User): UserResponse {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
