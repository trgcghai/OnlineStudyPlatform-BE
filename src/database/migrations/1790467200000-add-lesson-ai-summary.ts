import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLessonAiSummary1790467200000 implements MigrationInterface {
  name = 'AddLessonAiSummary1790467200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."lessons_summary_status_enum" AS ENUM('pending', 'processing', 'ready', 'failed')`,
    );
    await queryRunner.query(`ALTER TABLE "lessons" ADD "summary_text" text`);
    await queryRunner.query(
      `ALTER TABLE "lessons" ADD "summary_status" "public"."lessons_summary_status_enum" NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(`ALTER TABLE "lessons" ADD "summary_error" text`);
    await queryRunner.query(
      `ALTER TABLE "lessons" ADD "summary_source_video_url" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "lessons" ADD "summary_updated_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lessons" DROP COLUMN "summary_updated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lessons" DROP COLUMN "summary_source_video_url"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lessons" DROP COLUMN "summary_error"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lessons" DROP COLUMN "summary_status"`,
    );
    await queryRunner.query(`ALTER TABLE "lessons" DROP COLUMN "summary_text"`);
    await queryRunner.query(`DROP TYPE "public"."lessons_summary_status_enum"`);
  }
}
