import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLessonSummaryAudio1790640000000 implements MigrationInterface {
  name = 'AddLessonSummaryAudio1790640000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lessons" ADD "summary_audio_url" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lessons" DROP COLUMN "summary_audio_url"`,
    );
  }
}
