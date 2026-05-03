import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiMessageJobs1765000000000 implements MigrationInterface {
  name = 'AddAiMessageJobs1765000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_message_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "requesterId" uuid NOT NULL,
        "instruction" text NOT NULL,
        "recipients" jsonb NOT NULL,
        "options" jsonb,
        "status" character varying(20) NOT NULL DEFAULT 'queued',
        "attempts" integer NOT NULL DEFAULT 0,
        "errorMessage" text,
        "results" jsonb,
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_message_jobs_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_message_jobs_status" ON "ai_message_jobs" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_message_jobs_requesterId" ON "ai_message_jobs" ("requesterId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_message_jobs_requesterId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_message_jobs_status"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_message_jobs"`);
  }
}
