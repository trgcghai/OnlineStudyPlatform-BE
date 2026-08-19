import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { SampleUsersSeed } from '../../common/seeds/sampleUsers.seed';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService, SampleUsersSeed],
  exports: [UsersService],
})
export class UsersModule {}
