import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiZenChatAndUserMemory1780000000000
  implements MigrationInterface
{
  name = 'AddAiZenChatAndUserMemory1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_user_memory" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "memory" text NOT NULL DEFAULT '',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_user_memory_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ai_user_memory_userId" ON "ai_user_memory" ("userId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_zen_chat_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "role" character varying(16) NOT NULL,
        "kind" character varying(32) NOT NULL DEFAULT 'chat',
        "content" text NOT NULL,
        "meta" jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_zen_chat_messages_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_zen_chat_messages_userId" ON "ai_zen_chat_messages" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_zen_chat_messages_userId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_zen_chat_messages"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_user_memory_userId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_user_memory"`);
  }
}
