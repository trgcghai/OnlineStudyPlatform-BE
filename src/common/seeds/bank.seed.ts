import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { normalizeVietQrBankResponse } from '../utils/bank-catalog.util';
import {
  BankCatalog,
  BankCatalogDocument,
} from '../../modules/users/schemas/bank-catalog.schema';

const BANK_CATALOG_SOURCE = 'vietqr';
const VIETQR_BANKS_URL = 'https://vietqr.app/banks.json';

@Injectable()
export class BankSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger(BankSeed.name);

  constructor(
    @InjectModel(BankCatalog.name)
    private readonly bankCatalogModel: Model<BankCatalogDocument>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const response = await fetch(VIETQR_BANKS_URL);
      if (!response.ok) {
        throw new Error(`VietQR bank fetch failed: ${response.status}`);
      }

      const banks = normalizeVietQrBankResponse(await response.json());
      await this.bankCatalogModel
        .findOneAndUpdate(
          { source: BANK_CATALOG_SOURCE },
          { source: BANK_CATALOG_SOURCE, banks, fetchedAt: new Date() },
          { upsert: true, new: true },
        )
        .exec();
      this.logger.log(`Seeded ${banks.length} VietQR banks`);
    } catch (error) {
      this.logger.warn(
        `Skipped VietQR bank seed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
