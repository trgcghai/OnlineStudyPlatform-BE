import { randomUUID } from 'node:crypto';
import { MigrationInterface, QueryRunner } from 'typeorm';

const ORDER_STATUS_VALUES = [
  'pending',
  'paid',
  'failed',
  'cancelled',
  'expired',
  'refunded',
];

export class AddOrdersAndBackfillPayments1769030400000 implements MigrationInterface {
  name = 'AddOrdersAndBackfillPayments1769030400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        CREATE TYPE "public"."orders_status_enum" AS ENUM(${ORDER_STATUS_VALUES.map((value) => `'${value}'`).join(', ')});
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "orders" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "learner_id" uuid NOT NULL,
        "total_amount" integer NOT NULL,
        "currency" character varying(3) NOT NULL DEFAULT 'VND',
        "status" "public"."orders_status_enum" NOT NULL DEFAULT 'pending',
        "expires_at" TIMESTAMP NOT NULL,
        "paid_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orders_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_orders_learner" FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL,
        "course_id" uuid NOT NULL,
        "instructor_id" uuid NOT NULL,
        "unit_price" integer NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_order_items_order_course" UNIQUE ("order_id", "course_id"),
        CONSTRAINT "FK_order_items_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_order_items_course" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_order_items_instructor" FOREIGN KEY ("instructor_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `ALTER TABLE "payment_transactions" ADD COLUMN IF NOT EXISTS "order_id" uuid`,
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_payment_transactions_order'
        ) THEN
          ALTER TABLE "payment_transactions"
            ADD CONSTRAINT "FK_payment_transactions_order"
            FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    const transactions = (await queryRunner.query(`
      SELECT
        "id",
        "learner_id",
        "course_id",
        "amount",
        "currency",
        "status",
        "expires_at",
        "paid_at",
        "created_at",
        "updated_at"
      FROM "payment_transactions"
      ORDER BY "created_at", "id"
    `)) as Array<{
      id: string;
      learner_id: string;
      course_id: string;
      amount: number;
      currency: string;
      status: string;
      expires_at: Date;
      paid_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>;

    for (const transaction of transactions) {
      const learner = await queryRunner.query(
        `SELECT "id" FROM "users" WHERE "id" = $1`,
        [transaction.learner_id],
      );
      const course = (await queryRunner.query(
        `SELECT "id", "instructor_id" FROM "courses" WHERE "id" = $1`,
        [transaction.course_id],
      )) as Array<{ id: string; instructor_id: string }>;

      if (learner.length === 0) {
        throw new Error(
          `Cannot migrate payment ${transaction.id}: learner ${transaction.learner_id} does not exist`,
        );
      }
      if (course.length === 0) {
        throw new Error(
          `Cannot migrate payment ${transaction.id}: course ${transaction.course_id} does not exist`,
        );
      }

      const orderId = randomUUID();
      await queryRunner.query(
        `
          INSERT INTO "orders" (
            "id", "learner_id", "total_amount", "currency", "status",
            "expires_at", "paid_at", "created_at", "updated_at"
          ) VALUES ($1, $2, $3, $4, $5::"public"."orders_status_enum", $6, $7, $8, $9)
        `,
        [
          orderId,
          transaction.learner_id,
          transaction.amount,
          transaction.currency,
          transaction.status,
          transaction.expires_at,
          transaction.paid_at,
          transaction.created_at,
          transaction.updated_at,
        ],
      );

      await queryRunner.query(
        `
          INSERT INTO "order_items" (
            "id", "order_id", "course_id", "instructor_id", "unit_price", "created_at"
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          randomUUID(),
          orderId,
          transaction.course_id,
          course[0].instructor_id,
          transaction.amount,
          transaction.created_at,
        ],
      );

      await queryRunner.query(
        `UPDATE "payment_transactions" SET "order_id" = $1 WHERE "id" = $2`,
        [orderId, transaction.id],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_transactions" DROP CONSTRAINT IF EXISTS "FK_payment_transactions_order"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_transactions" DROP COLUMN IF EXISTS "order_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "order_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "orders"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."orders_status_enum"`,
    );
  }
}
