import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLessonVectorKnowledge1790726400000 implements MigrationInterface {
  name = 'AddLessonVectorKnowledge1790726400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lesson_summaries" ADD "transcript_text" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_summaries" ADD "transcript_language" character varying(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_summaries" ADD "transcript_duration_seconds" double precision`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_summaries" ADD "transcribed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."lesson_knowledge_sources_source_type_enum" AS ENUM('transcript', 'material')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."lesson_knowledge_sources_status_enum" AS ENUM('pending', 'processing', 'ready', 'failed')`,
    );
    await queryRunner.query(`
      CREATE TABLE "lesson_knowledge_sources" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "course_id" uuid NOT NULL,
        "lesson_id" uuid NOT NULL,
        "source_type" "public"."lesson_knowledge_sources_source_type_enum" NOT NULL,
        "source_url" character varying,
        "content_hash" character varying(64) NOT NULL,
        "status" "public"."lesson_knowledge_sources_status_enum" NOT NULL DEFAULT 'pending',
        "chunk_count" integer NOT NULL DEFAULT 0,
        "error" text,
        "indexed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_lesson_knowledge_source_lesson_type" UNIQUE ("lesson_id", "source_type"),
        CONSTRAINT "PK_lesson_knowledge_sources" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_lesson_knowledge_source_course_status" ON "lesson_knowledge_sources" ("course_id", "status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_knowledge_sources" ADD CONSTRAINT "FK_lesson_knowledge_source_course" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_knowledge_sources" ADD CONSTRAINT "FK_lesson_knowledge_source_lesson" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lesson_knowledge_sources" DROP CONSTRAINT "FK_lesson_knowledge_source_lesson"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_knowledge_sources" DROP CONSTRAINT "FK_lesson_knowledge_source_course"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_lesson_knowledge_source_course_status"`,
    );
    await queryRunner.query(`DROP TABLE "lesson_knowledge_sources"`);
    await queryRunner.query(
      `DROP TYPE "public"."lesson_knowledge_sources_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."lesson_knowledge_sources_source_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_summaries" DROP COLUMN "transcribed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_summaries" DROP COLUMN "transcript_duration_seconds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_summaries" DROP COLUMN "transcript_language"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_summaries" DROP COLUMN "transcript_text"`,
    );
  }
}
