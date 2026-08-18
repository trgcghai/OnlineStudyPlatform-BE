import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { CreateUserDto, RegisterUserResponse } from './dto/user.dto';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<RegisterUserResponse> {
    const { name, email, password } = createUserDto;
    if (
      await this.usersRepository.findOneBy({
        email: email.trim().toLowerCase(),
      })
    ) {
      throw new ConflictException('Email already registered');
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);

      const user = this.usersRepository.create({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password: hashedPassword,
      });

      const savedUser = await this.usersRepository.save(user);
      return {
        id: savedUser.id,
        name: savedUser.name,
        email: savedUser.email,
        role: savedUser.role,
        avatar: savedUser.avatar,
        status: savedUser.status,
        createdAt: savedUser.createdAt,
        updatedAt: savedUser.updatedAt,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error('Error creating user:', error);
      throw new BadRequestException(error);
    }
  }
}
