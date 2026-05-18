import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateCallRecordCallType1779104118270 implements MigrationInterface {
  name = 'UpdateCallRecordCallType1779104118270';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "call_records" SET "callType" = 'audio' WHERE "callType" IS NULL OR "callType" = 'voice'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "call_records" SET "callType" = 'voice' WHERE "callType" IN ('audio', 'video')`,
    );
  }
}
