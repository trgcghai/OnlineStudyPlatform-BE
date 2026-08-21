import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { Client as MinioClient } from 'minio';
import { Repository } from 'typeorm';
import { MINIO_CLIENT } from '../../common/constants/file.constant';
import {
  ChangePasswordDto,
  CreateUserDto,
  UpdateProfileDto,
  UserResponse,
} from './dto/user.dto';
import { User } from './entities/user.entity';

const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly configService: ConfigService,
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOneBy({
      email: email.trim().toLowerCase(),
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ id });
  }

  async create(createUserDto: CreateUserDto): Promise<UserResponse> {
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

      const user = this.usersRepository.create({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password: hashedPassword,
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
