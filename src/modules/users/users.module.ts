import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUsersController } from './admin-users.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { SampleDataSeed } from '../../common/seeds/sampleData.seed';
import { Course } from '../courses/entities/course.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Course])],
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService, SampleDataSeed],
  exports: [UsersService],
})
export class UsersModule {}
