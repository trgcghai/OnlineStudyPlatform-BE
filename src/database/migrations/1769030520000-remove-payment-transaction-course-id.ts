import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class RemovePaymentTransactionCourseId1769030520000 implements MigrationInterface {
  name = 'RemovePaymentTransactionCourseId1769030520000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const checks = [
      [
        'unlinked payments',
        `SELECT COUNT(*)::int AS count FROM "payment_transactions" WHERE "order_id" IS NULL`,
      ],
      [
        'missing orders',
        `SELECT COUNT(*)::int AS count FROM "payment_transactions" p LEFT JOIN "orders" o ON o.id = p.order_id WHERE o.id IS NULL`,
      ],
      [
        'empty orders',
        `SELECT COUNT(*)::int AS count FROM "orders" o WHERE NOT EXISTS (SELECT 1 FROM "order_items" i WHERE i.order_id = o.id)`,
      ],
      [
        'order total mismatches',
        `SELECT COUNT(*)::int AS count FROM "orders" o WHERE o.total_amount <> (SELECT COALESCE(SUM(i.unit_price), 0) FROM "order_items" i WHERE i.order_id = o.id)`,
      ],
    ] as const;

    for (const [label, sql] of checks) {
      const [{ count }] = (await queryRunner.query(sql)) as Array<{
        count: number;
      }>;
      if (count !== 0) {
        throw new Error(
          `Cannot remove payment_transactions.course_id: ${label} = ${count}`,
        );
      }
    }

    const table = await queryRunner.getTable('payment_transactions');
    const courseForeignKey = table?.foreignKeys.find((foreignKey) =>
      foreignKey.columnNames.includes('course_id'),
    );
    if (courseForeignKey) {
      await queryRunner.dropForeignKey(
        'payment_transactions',
        courseForeignKey,
      );
    }

    if (table?.findColumnByName('course_id')) {
      await queryRunner.dropColumn('payment_transactions', 'course_id');
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'payment_transactions',
      new TableColumn({
        name: 'course_id',
        type: 'uuid',
        isNullable: true,
      }),
    );
  }
}
