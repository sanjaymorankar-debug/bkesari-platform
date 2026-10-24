<?php

namespace Tests\Feature\Platform;

use App\Database\PostgresConnector;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\ConfigurationUrlParser;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Pdo\Pgsql;
use RuntimeException;
use Tests\TestCase;

/**
 * The database settings every tier runs on: Neon's PostgreSQL, reached over a
 * pooled endpoint (PgBouncer in transaction mode) by the app and over a direct
 * one by migrations. See config/database.php and DatabaseServiceProvider.
 *
 * Most of this reads configuration and runs everywhere. The tests that need a
 * real server skip on SQLite; CI runs the suite on PostgreSQL, and the spec's
 * Neon parity level runs the whole suite through a real PgBouncer. Which
 * commands use the direct endpoint is in SchemaCommandRoutingTest.
 */
class NeonReadinessTest extends TestCase
{
    use RefreshDatabase;

    // Shaped like Neon's strings, under the reserved .invalid domain so that
    // nothing here could ever resolve, let alone connect.
    private const POOLED = 'postgresql://bk_edu_app:secret@ep-example-123456-pooler.ap-southeast-1.aws.neon.invalid/bk_edu?sslmode=require&channel_binding=require';

    private const DIRECT = 'postgresql://bk_edu_app:secret@ep-example-123456.ap-southeast-1.aws.neon.invalid/bk_edu?sslmode=require&channel_binding=require';

    public function test_a_neon_url_keeps_tls_and_channel_binding_all_the_way_to_libpq(): void
    {
        $config = (new ConfigurationUrlParser)->parseConfiguration(
            ['url' => self::POOLED] + config('database.connections.pgsql')
        );

        $this->assertSame('ep-example-123456-pooler.ap-southeast-1.aws.neon.invalid', $config['host']);
        $this->assertSame('bk_edu', $config['database']);
        $this->assertSame('bk_edu_app', $config['username']);

        $dsn = $this->dsnFor($config);

        // Laravel's own connector passes sslmode on but dropped channel_binding.
        $this->assertStringContainsString(';sslmode=require', $dsn);
        $this->assertStringContainsString(';channel_binding=require', $dsn);
    }

    public function test_a_url_wins_over_a_db_sslmode_left_at_its_local_default(): void
    {
        $config = (new ConfigurationUrlParser)->parseConfiguration(
            ['url' => self::POOLED, 'sslmode' => 'prefer'] + config('database.connections.pgsql')
        );

        $this->assertSame('require', $config['sslmode']);
    }

    public function test_an_unknown_channel_binding_value_is_refused_rather_than_written_into_the_dsn(): void
    {
        $this->expectException(InvalidArgumentException::class);

        $this->dsnFor(['host' => 'localhost', 'database' => 'edu', 'channel_binding' => 'require;sslmode=disable']);
    }

    public function test_no_session_level_set_is_issued_on_connect(): void
    {
        // Each of these makes Laravel run a SET right after connecting, which
        // a transaction-mode pooler does not carry over to later queries.
        foreach (['pgsql', 'pgsql_unpooled'] as $name) {
            $connection = config("database.connections.$name");

            foreach (['search_path', 'schema', 'timezone', 'isolation_level', 'synchronous_commit'] as $key) {
                $this->assertArrayNotHasKey($key, $connection, "$name sets $key on every connect");
            }
        }
    }

    public function test_named_server_side_prepared_statements_are_switched_off(): void
    {
        if (! extension_loaded('pdo_pgsql')) {
            $this->markTestSkipped('pdo_pgsql is not loaded.');
        }

        $attribute = PHP_VERSION_ID >= 80500 ? Pgsql::ATTR_DISABLE_PREPARES : \PDO::PGSQL_ATTR_DISABLE_PREPARES;

        foreach (['pgsql', 'pgsql_unpooled'] as $name) {
            $this->assertTrue(config("database.connections.$name.options")[$attribute] ?? false, $name);
        }
    }

    public function test_the_app_leaves_no_named_prepared_statement_on_the_server(): void
    {
        $this->requirePgsql();

        // Before the fix every query was a named statement (pdo_stmt_...), and
        // freeing it with an SQL DEALLOCATE is what aborted transactions behind
        // the pooler. With it switched off PDO names none, ever. (Behind
        // PgBouncer the server may still list PGBOUNCER_* statements of its
        // own, so only PDO's names are counted.)
        DB::table('users')->where('id', 1)->exists();
        DB::table('roles')->where('name', 'parent')->value('id');

        $this->assertSame(0, (int) DB::scalar("select count(*) from pg_prepared_statements where name like 'pdo_stmt_%'"));
    }

    public function test_a_transaction_of_several_statements_commits(): void
    {
        $this->requirePgsql();

        // The shape that failed on the pooled endpoint: the second statement
        // in a transaction found it already aborted.
        DB::transaction(function () {
            DB::table('settings')->insert(['key' => 'neon.check', 'value' => 'one', 'created_at' => now(), 'updated_at' => now()]);
            DB::table('settings')->where('key', 'neon.check')->update(['value' => 'two']);
        });

        $this->assertSame('two', DB::table('settings')->where('key', 'neon.check')->value('value'));
    }

    public function test_the_direct_connection_falls_back_to_db_url_and_then_to_the_db_lines(): void
    {
        $this->assertSame(self::DIRECT, $this->databaseConfigWith(['DB_URL' => self::POOLED, 'DB_URL_UNPOOLED' => self::DIRECT])['pgsql_unpooled']['url']);
        $this->assertSame(self::POOLED, $this->databaseConfigWith(['DB_URL' => self::POOLED, 'DB_URL_UNPOOLED' => ''])['pgsql_unpooled']['url']);

        $local = $this->databaseConfigWith(['DB_URL' => '', 'DB_URL_UNPOOLED' => '', 'DB_HOST' => 'db.local']);
        $this->assertEmpty($local['pgsql_unpooled']['url']);
        $this->assertSame('db.local', $local['pgsql_unpooled']['host']);
        $this->assertSame(self::POOLED, $this->databaseConfigWith(['DB_URL' => self::POOLED, 'DB_URL_UNPOOLED' => self::DIRECT])['pgsql']['url']);
    }

    public function test_the_suite_refuses_a_hosted_database(): void
    {
        foreach (['127.0.0.1', 'localhost', '::1', '/tmp', '/var/run/postgresql', 'postgres'] as $host) {
            TestCase::assertLocalDatabase(['host' => $host]);
        }

        $this->expectException(RuntimeException::class);
        TestCase::assertLocalDatabase((new ConfigurationUrlParser)->parseConfiguration(['url' => self::POOLED]));
    }

    public function test_the_suite_refuses_a_hosted_direct_endpoint(): void
    {
        // What a test run would build from a DB_URL_UNPOOLED line naming Neon.
        $direct = $this->databaseConfigWith(['DB_URL' => '', 'DB_URL_UNPOOLED' => self::DIRECT])['pgsql_unpooled'];

        $this->expectException(RuntimeException::class);
        TestCase::assertLocalDatabase((new ConfigurationUrlParser)->parseConfiguration($direct), 'pgsql_unpooled');
    }

    public function test_the_suite_refuses_laravels_own_direct_key_naming_a_hosted_server(): void
    {
        $this->expectException(RuntimeException::class);
        TestCase::assertLocalDatabase(['host' => '127.0.0.1', 'direct' => ['host' => 'ep-example-123456.ap-southeast-1.aws.neon.invalid']]);
    }

    private function dsnFor(array $config): string
    {
        $connector = new PostgresConnector;

        return (fn () => $this->getDsn($config))->call($connector);
    }

    /**
     * config/database.php's connections, evaluated with these variables set.
     */
    private function databaseConfigWith(array $variables): array
    {
        $saved = [];

        foreach ($variables as $name => $value) {
            $saved[$name] = [$_ENV[$name] ?? null, $_SERVER[$name] ?? null, getenv($name)];
            $_ENV[$name] = $_SERVER[$name] = $value;
            putenv("$name=$value");
        }

        try {
            return (require config_path('database.php'))['connections'];
        } finally {
            foreach ($saved as $name => [$env, $server, $put]) {
                if ($env === null) {
                    unset($_ENV[$name]);
                } else {
                    $_ENV[$name] = $env;
                }
                if ($server === null) {
                    unset($_SERVER[$name]);
                } else {
                    $_SERVER[$name] = $server;
                }
                putenv($put === false ? $name : "$name=$put");
            }
        }
    }

    private function requirePgsql(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            $this->markTestSkipped('Needs a PostgreSQL server; run the suite with DB_CONNECTION=pgsql.');
        }
    }
}
