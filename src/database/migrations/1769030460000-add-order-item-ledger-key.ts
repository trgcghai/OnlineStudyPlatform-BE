import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderItemLedgerKey1769030460000 implements MigrationInterface {
  name = 'AddOrderItemLedgerKey1769030460000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "instructor_balance_ledger" ADD COLUMN IF NOT EXISTS "order_item_id" uuid`,
    );

    await queryRunner.query(`
      UPDATE "instructor_balance_ledger" ledger
      SET "order_item_id" = item.id
      FROM "payment_transactions" payment
      CROSS JOIN "order_items" item
      WHERE ledger.payment_transaction_id = payment.id
        AND payment.order_id IS NOT NULL
        AND item.order_id = payment.order_id
        AND item.course_id = ledger.course_id
        AND ledger.order_item_id IS NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_instructor_balance_ledger_order_item'
        ) THEN
          ALTER TABLE "instructor_balance_ledger"
            ADD CONSTRAINT "FK_instructor_balance_ledger_order_item"
            FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_instructor_balance_ledger_payment"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_instructor_balance_ledger_order_item"
      ON "instructor_balance_ledger" ("order_item_id")
      WHERE "order_item_id" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_instructor_balance_ledger_order_item"`,
    );
    await queryRunner.query(
      `ALTER TABLE "instructor_balance_ledger" DROP CONSTRAINT IF EXISTS "FK_instructor_balance_ledger_order_item"`,
    );
    await queryRunner.query(
      `ALTER TABLE "instructor_balance_ledger" DROP COLUMN IF EXISTS "order_item_id"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_instructor_balance_ledger_payment"
      ON "instructor_balance_ledger" ("payment_transaction_id")
      WHERE "payment_transaction_id" IS NOT NULL
    `);
  }
}
