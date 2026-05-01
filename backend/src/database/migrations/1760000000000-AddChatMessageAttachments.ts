import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatMessageAttachments1760000000000
  implements MigrationInterface
{
  name = 'AddChatMessageAttachments1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "attachmentUrl" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "attachmentType" character varying(32)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_messages" DROP COLUMN IF EXISTS "attachmentType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_messages" DROP COLUMN IF EXISTS "attachmentUrl"`,
    );
  }
}

