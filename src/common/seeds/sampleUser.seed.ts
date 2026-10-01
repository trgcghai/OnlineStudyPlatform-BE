import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';

import {
  User,
  UserRole,
  UserStatus,
} from '../../modules/users/entities/user.entity';

const SAMPLE_PASSWORD = 'Abc@1234';

const SAMPLE_USERS = [
  {
    name: 'System Admin',
    email: 'admin@gmail.com',
    role: UserRole.ADMIN,
  },
  {
    name: 'Sample Learner',
    email: 'learner@gmail.com',
    role: UserRole.LEARNER,
  },
  {
    name: 'Sample Instructor',
    email: 'instructor@gmail.com',
    role: UserRole.INSTRUCTOR,
  },
] as const;

@Injectable()
export class SampleUserSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger(SampleUserSeed.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const password = await bcrypt.hash(SAMPLE_PASSWORD, 10);

    for (const sampleUser of SAMPLE_USERS) {
      const email = sampleUser.email.trim().toLowerCase();
      const existingUser = await this.usersRepository.findOneBy({ email });
      if (existingUser) continue;

      const user = this.usersRepository.create({
        name: sampleUser.name,
        email,
        password,
        role: sampleUser.role,
        avatar: null,
        status: UserStatus.ACTIVE,
      });

      await this.usersRepository.save(user);
      this.logger.log(`Created sample user: ${email}`);
    }
  }
}
