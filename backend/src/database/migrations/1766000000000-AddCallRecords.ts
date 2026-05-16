import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCallRecords1766000000000 implements MigrationInterface {
  name = 'AddCallRecords1766000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "call_records" (
        "id"                uuid            NOT NULL DEFAULT uuid_generate_v4(),
        "conversationId"    uuid            NOT NULL,
        "callerId"          uuid            NOT NULL,
        "calleeId"          uuid            NOT NULL,
        "callType"          character varying(16) NOT NULL DEFAULT 'voice',
        "outcome"           character varying(16) NOT NULL,
        "durationSeconds"   integer,
        "startedAt"         TIMESTAMP WITH TIME ZONE NOT NULL,
        "answeredAt"        TIMESTAMP WITH TIME ZONE,
        "endedAt"           TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt"         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_call_records" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_call_records_conversationId" ON "call_records" ("conversationId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_call_records_callerId" ON "call_records" ("callerId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_call_records_calleeId" ON "call_records" ("calleeId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_call_records_calleeId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_call_records_callerId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_call_records_conversationId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "call_records"`);
  }
}
