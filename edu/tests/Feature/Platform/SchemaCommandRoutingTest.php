<?php

namespace Tests\Feature\Platform;

use App\Providers\DatabaseServiceProvider;
use Illuminate\Console\Events\CommandFinished;
use Illuminate\Console\Events\CommandStarting;
use Symfony\Component\Console\Input\ArrayInput;
use Symfony\Component\Console\Output\NullOutput;
use Tests\TestCase;

/**
 * Which artisan commands run on Neon's direct endpoint (DB_URL_UNPOOLED) and
 * which stay on the pooled one (DB_URL). See DatabaseServiceProvider.
 *
 * Laravel does not raise console command events under PHPUnit, so the events
 * are raised here by hand. Nothing in this class opens a database connection:
 * it deliberately has no RefreshDatabase, and the URLs are under the reserved
 * .invalid domain. The real artisan path is covered by the spec's Neon parity
 * level, which runs `migrate` with an unreachable pooled URL.
 */
class SchemaCommandRoutingTest extends TestCase
{
    private const POOLED = 'postgresql://bk_edu_app:secret@ep-example-123456-pooler.ap-southeast-1.aws.neon.invalid/bk_edu?sslmode=require';

    private const DIRECT = 'postgresql://bk_edu_app:secret@ep-example-123456.ap-southeast-1.aws.neon.invalid/bk_edu?sslmode=require';

    protected function setUp(): void
    {
        parent::setUp();

        // The URLs a Neon tier's .env carries.
        config([
            'database.default' => 'pgsql',
            'database.connections.pgsql.url' => self::POOLED,
            'database.connections.pgsql_unpooled.url' => self::DIRECT,
        ]);
    }

    public function test_schema_commands_move_to_the_direct_endpoint_and_back(): void
    {
        foreach (DatabaseServiceProvider::SCHEMA_COMMANDS as $command) {
            $this->startCommand($command);
            $this->assertSame('pgsql_unpooled', config('database.default'), $command);

            $this->finishCommand($command);
            $this->assertSame('pgsql', config('database.default'), "$command did not put the default back");
        }
    }

    public function test_an_explicit_database_option_wins(): void
    {
        $this->startCommand('migrate', ['--database' => 'pgsql']);

        $this->assertSame('pgsql', config('database.default'));
    }

    public function test_other_commands_stay_on_the_pooled_endpoint(): void
    {
        foreach (['analytics:recalculate', 'schedule:run', 'tinker', 'optimize', 'config:cache'] as $command) {
            $this->startCommand($command);
            $this->assertSame('pgsql', config('database.default'), $command);
        }
    }

    public function test_nothing_moves_when_the_direct_url_is_the_pooled_one(): void
    {
        config(['database.connections.pgsql_unpooled.url' => self::POOLED]);

        $this->startCommand('migrate');

        $this->assertSame('pgsql', config('database.default'));
    }

    public function test_nothing_moves_on_a_local_database_configured_by_the_db_lines(): void
    {
        config(['database.connections.pgsql.url' => null, 'database.connections.pgsql_unpooled.url' => null]);

        $this->startCommand('migrate');

        $this->assertSame('pgsql', config('database.default'));
    }

    public function test_a_non_pgsql_default_is_left_alone(): void
    {
        config(['database.default' => 'sqlite']);

        $this->startCommand('migrate');

        $this->assertSame('sqlite', config('database.default'));
    }

    public function test_the_decision_survives_config_cache(): void
    {
        // A cached configuration is the arrays below with env() already
        // resolved; the provider reads nothing else, so a tier that ran
        // `php artisan optimize` routes exactly like one that did not.
        $cached = var_export(config('database'), true);

        $this->assertStringContainsString(self::DIRECT, $cached);
        $this->assertStringNotContainsString('env(', $cached);
        $this->assertStringNotContainsString('getenv', file_get_contents(app_path('Providers/DatabaseServiceProvider.php')));
        $this->assertStringNotContainsString('env(', file_get_contents(app_path('Providers/DatabaseServiceProvider.php')));
    }

    private function startCommand(string $command, array $parameters = []): void
    {
        event(new CommandStarting($command, new ArrayInput($parameters), new NullOutput));
    }

    private function finishCommand(string $command): void
    {
        event(new CommandFinished($command, new ArrayInput([]), new NullOutput, 0));
    }
}
