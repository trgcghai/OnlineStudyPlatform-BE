import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLessonImports1790380800000 implements MigrationInterface {
  name = 'AddLessonImports1790380800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."lesson_imports_status_enum" AS ENUM('uploading', 'queued', 'processing', 'completed', 'failed', 'aborted');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lesson_imports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "course_id" uuid NOT NULL,
        "instructor_id" uuid NOT NULL,
        "source_filename" character varying(255) NOT NULL,
        "source_object_key" character varying(500) NOT NULL,
        "declared_size" bigint NOT NULL,
        "multipart_upload_id" character varying(500) NOT NULL,
        "expected_part_count" integer NOT NULL,
        "status" "public"."lesson_imports_status_enum" NOT NULL,
        "progress" integer NOT NULL DEFAULT 0,
        "error_details" jsonb NOT NULL DEFAULT '[]',
        "created_lesson_count" integer NOT NULL DEFAULT 0,
        "first_position" integer,
        "last_position" integer,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lesson_imports" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lesson_imports_course" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_lesson_imports_instructor" FOREIGN KEY ("instructor_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lesson_imports_course_status" ON "lesson_imports" ("course_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lesson_imports_created_at" ON "lesson_imports" ("created_at")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lesson_imports_active_course"
      ON "lesson_imports" ("course_id")
      WHERE "status" IN ('uploading', 'queued', 'processing')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_lesson_imports_active_course"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_lesson_imports_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_lesson_imports_course_status"`,
    );
    await queryRunner.query(`DROP TABLE "lesson_imports"`);
    await queryRunner.query(`DROP TYPE "public"."lesson_imports_status_enum"`);
  }
}
