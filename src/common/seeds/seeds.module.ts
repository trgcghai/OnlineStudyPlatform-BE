import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '../../modules/users/entities/user.entity';
import {
  BankCatalog,
  BankCatalogSchema,
} from '../../modules/users/schemas/bank-catalog.schema';
import { BankSeed } from './bank.seed';
import { SampleUserSeed } from './sampleUser.seed';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    MongooseModule.forFeature([
      { name: BankCatalog.name, schema: BankCatalogSchema },
    ]),
  ],
  providers: [SampleUserSeed, BankSeed],
})
export class SeedsModule {}
