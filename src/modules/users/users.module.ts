import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUsersController } from './admin-users.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { InstructorAccount } from './entities/instructor-account.entity';
import { User } from './entities/user.entity';
import { BankCatalog, BankCatalogSchema } from './schemas/bank-catalog.schema';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, InstructorAccount]),
    MongooseModule.forFeature([
      { name: BankCatalog.name, schema: BankCatalogSchema },
    ]),
  ],
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
