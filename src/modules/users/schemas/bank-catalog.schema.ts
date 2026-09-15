import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export interface BankOption {
  name: string;
  code: string;
  bin: string;
  shortName: string;
}

@Schema({ timestamps: true, collection: 'bank_catalog_cache' })
export class BankCatalog {
  @Prop({ required: true, unique: true })
  source!: 'vietqr';

  @Prop({
    type: [
      {
        name: { type: String, required: true },
        code: { type: String, required: true },
        bin: { type: String, required: true },
        shortName: { type: String, required: true },
      },
    ],
    required: true,
    default: [],
  })
  banks!: BankOption[];

  @Prop({ required: true })
  fetchedAt!: Date;
}

export type BankCatalogDocument = HydratedDocument<BankCatalog>;
export const BankCatalogSchema = SchemaFactory.createForClass(BankCatalog);
