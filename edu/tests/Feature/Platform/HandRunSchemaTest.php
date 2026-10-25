<?php

namespace Tests\Feature\Platform;

use Tests\TestCase;

/**
 * database/edu/01_edu_schema.sql is the hand-run copy of what the migrations
 * build (TEST_SPEC.md S3c). Its migrations log must name every migration, or a
 * tier loaded from it silently lacks that migration's schema while
 * `migrate --pretend` still shows it pending.
 */
class HandRunSchemaTest extends TestCase
{
    private const SCHEMA = __DIR__.'/../../../../database/edu/01_edu_schema.sql';

    public function test_the_hand_run_schema_logs_every_migration(): void
    {
        if (! is_file(self::SCHEMA)) {
            $this->markTestSkipped('database/edu/ is not beside this copy of the app');
        }
        $sql = file_get_contents(self::SCHEMA);

        $missing = [];
        foreach (glob(database_path('migrations/*.php')) as $file) {
            $name = basename($file, '.php');
            if (! str_contains($sql, "'{$name}', 1)")) {
                $missing[] = $name;
            }
        }

        $this->assertSame([], $missing, 'Regenerate database/edu/01_edu_schema.sql (TEST_SPEC.md R3, database/migrations/**)');
    }

    public function test_the_hand_run_schema_has_the_hub_user_link(): void
    {
        if (! is_file(self::SCHEMA)) {
            $this->markTestSkipped('database/edu/ is not beside this copy of the app');
        }
        $sql = file_get_contents(self::SCHEMA);

        $this->assertTrue(str_contains($sql, 'hub_user_id character varying(80)'), 'users.hub_user_id is missing');
        $this->assertTrue(str_contains($sql, 'ADD CONSTRAINT users_hub_user_id_unique UNIQUE (hub_user_id);'), 'users_hub_user_id_unique is missing');
    }
}
