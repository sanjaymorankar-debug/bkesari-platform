<?php

namespace App\Providers;

use App\Database\PostgresConnector;
use Illuminate\Console\Events\CommandFinished;
use Illuminate\Console\Events\CommandStarting;
use Illuminate\Contracts\Config\Repository;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;

/**
 * PostgreSQL the way Neon serves it: a pooled endpoint for the app, a direct
 * one for schema work (see config/database.php).
 *
 * The schema commands below run on the `pgsql_unpooled` connection whenever
 * DB_URL_UNPOOLED gives it an endpoint of its own, so `php artisan migrate
 * --force` on a server does the right thing without anyone remembering a flag.
 * An explicit `--database=...` always wins. The decision reads configuration
 * only, never the environment, so it holds under `config:cache`, which is how
 * every tier runs (the deploy runs `php artisan optimize`).
 *
 * Laravel does not raise console command events while the test suite runs, so
 * none of this happens under PHPUnit: RefreshDatabase migrates on the default
 * connection, as it always has.
 */
class DatabaseServiceProvider extends ServiceProvider
{
    /**
     * Commands that change or inspect the schema, or load data in bulk.
     */
    public const SCHEMA_COMMANDS = [
        'migrate',
        'migrate:fresh',
        'migrate:install',
        'migrate:refresh',
        'migrate:reset',
        'migrate:rollback',
        'migrate:status',
        'db:seed',
        'db:wipe',
        'schema:dump',
    ];

    public const POOLED = 'pgsql';

    public const DIRECT = 'pgsql_unpooled';

    /**
     * The default connection a schema command was moved off, to put back when
     * it finishes.
     */
    private ?string $movedFrom = null;

    public function register(): void
    {
        $this->app->bind('db.connector.pgsql', PostgresConnector::class);
    }

    public function boot(): void
    {
        Event::listen(CommandStarting::class, function (CommandStarting $event): void {
            $this->useDirectEndpointFor($event);
        });

        Event::listen(CommandFinished::class, function (): void {
            $this->restoreDefaultConnection();
        });
    }

    private function useDirectEndpointFor(CommandStarting $event): void
    {
        if (! in_array($event->command, self::SCHEMA_COMMANDS, true)
            || $event->input->hasParameterOption('--database')) {
            return;
        }

        $config = $this->app->make(Repository::class);

        if ($config->get('database.default') !== self::POOLED || ! $this->hasSeparateDirectEndpoint($config)) {
            return;
        }

        $this->movedFrom = self::POOLED;
        $config->set('database.default', self::DIRECT);
    }

    private function restoreDefaultConnection(): void
    {
        if ($this->movedFrom === null) {
            return;
        }

        $this->app->make(Repository::class)->set('database.default', $this->movedFrom);
        $this->movedFrom = null;
    }

    /**
     * True only when DB_URL_UNPOOLED named an endpoint that differs from the
     * pooled one. Without it the two connections are identical and moving
     * would only open a second connection to the same place.
     */
    private function hasSeparateDirectEndpoint(Repository $config): bool
    {
        $direct = (string) $config->get('database.connections.'.self::DIRECT.'.url');

        return $direct !== '' && $direct !== (string) $config->get('database.connections.'.self::POOLED.'.url');
    }
}
