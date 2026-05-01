import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatMessageAttachmentsTable1760000000001
  implements MigrationInterface
{
  name = 'AddChatMessageAttachmentsTable1760000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chat_message_attachments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "messageId" uuid NOT NULL,
        "type" character varying(16) NOT NULL,
        "key" text NOT NULL,
        "mime" character varying(128) NOT NULL,
        "size" bigint NOT NULL,
        "filename" character varying(512),
        "width" integer,
        "height" integer,
        "durationMs" integer,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_message_attachments_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_message_attachments_messageId" FOREIGN KEY ("messageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chat_message_attachments_messageId" ON "chat_message_attachments" ("messageId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_chat_message_attachments_messageId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_message_attachments"`);
  }
}

