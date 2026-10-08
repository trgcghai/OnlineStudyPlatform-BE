import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCertificates1791158400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "certificates" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "learner_id" uuid NOT NULL,
      "course_id" uuid NOT NULL,
      "issued_at" timestamptz NOT NULL,
      "certificate_url" character varying NOT NULL,
      "object_key" character varying NOT NULL,
      "learner_name" character varying NOT NULL,
      "course_title" character varying NOT NULL,
      CONSTRAINT "PK_certificates" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_certificates_learner_course" UNIQUE ("learner_id", "course_id"),
      CONSTRAINT "UQ_certificates_object_key" UNIQUE ("object_key"),
      CONSTRAINT "FK_certificates_learner" FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_certificates_course" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "certificates"');
  }
}
