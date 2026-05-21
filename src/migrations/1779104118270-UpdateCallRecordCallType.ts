import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateCallRecordCallType1779104118270 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "call_records_calltype_enum" RENAME TO "call_records_calltype_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "call_records_calltype_enum" AS ENUM('audio', 'video')`,
    );
    await queryRunner.query(
      `ALTER TABLE "call_records" ALTER COLUMN "callType" TYPE "call_records_calltype_enum" 
     USING "callType"::text::"call_records_calltype_enum"`,
    );
    await queryRunner.query(`DROP TYPE "call_records_calltype_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "call_records_calltype_enum" RENAME TO "call_records_calltype_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "call_records_calltype_enum" AS ENUM('voice')`,
    );
    await queryRunner.query(
      `ALTER TABLE "call_records" ALTER COLUMN "callType" TYPE "call_records_calltype_enum" 
     USING "callType"::text::"call_records_calltype_enum"`,
    );
    await queryRunner.query(`DROP TYPE "call_records_calltype_enum_old"`);
  }
}
