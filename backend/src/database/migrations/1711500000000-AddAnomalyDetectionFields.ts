import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnomalyDetectionFields1711500000000
  implements MigrationInterface
{
  name = 'AddAnomalyDetectionFields1711500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new columns to refresh_sessions table
    await queryRunner.query(`
      ALTER TABLE "refresh_sessions"
      ADD COLUMN IF NOT EXISTS "requiresStepUp" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_sessions"
      ADD COLUMN IF NOT EXISTS "lastKnownCountry" varchar(10) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_sessions"
      ADD COLUMN IF NOT EXISTS "lastKnownUserAgentHash" varchar(64) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_sessions"
      ADD COLUMN IF NOT EXISTS "userAgentRaw" varchar(255) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_sessions"
      ADD COLUMN IF NOT EXISTS "ipPrefix" varchar(50) NULL
    `);

    // Add new columns to refresh_events table
    await queryRunner.query(`
      ALTER TABLE "refresh_events"
      ADD COLUMN IF NOT EXISTS "ipAddress" varchar(45) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_events"
      ADD COLUMN IF NOT EXISTS "riskScore" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_events"
      ADD COLUMN IF NOT EXISTS "riskLevel" varchar(10) NOT NULL DEFAULT 'LOW'
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_events"
      ADD COLUMN IF NOT EXISTS "anomalySignals" jsonb NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_events"
      ADD COLUMN IF NOT EXISTS "isVpnOrProxy" boolean NOT NULL DEFAULT false
    `);

    // Create index on riskLevel for quick filtering of high-risk events
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_refresh_events_riskLevel"
      ON "refresh_events" ("riskLevel")
    `);

    // Create index on requiresStepUp for quick session lookup
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_refresh_sessions_requiresStepUp"
      ON "refresh_sessions" ("requiresStepUp")
      WHERE "requiresStepUp" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_refresh_events_riskLevel"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_refresh_sessions_requiresStepUp"
    `);

    // Drop columns from refresh_events
    await queryRunner.query(`
      ALTER TABLE "refresh_events"
      DROP COLUMN IF EXISTS "isVpnOrProxy"
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_events"
      DROP COLUMN IF EXISTS "anomalySignals"
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_events"
      DROP COLUMN IF EXISTS "riskLevel"
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_events"
      DROP COLUMN IF EXISTS "riskScore"
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_events"
      DROP COLUMN IF EXISTS "ipAddress"
    `);

    // Drop columns from refresh_sessions
    await queryRunner.query(`
      ALTER TABLE "refresh_sessions"
      DROP COLUMN IF EXISTS "ipPrefix"
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_sessions"
      DROP COLUMN IF EXISTS "userAgentRaw"
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_sessions"
      DROP COLUMN IF EXISTS "lastKnownUserAgentHash"
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_sessions"
      DROP COLUMN IF EXISTS "lastKnownCountry"
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_sessions"
      DROP COLUMN IF EXISTS "requiresStepUp"
    `);
  }
}
