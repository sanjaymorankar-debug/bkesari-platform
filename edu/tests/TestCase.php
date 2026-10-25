<?php

namespace Tests;

use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\ConfigurationUrlParser;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    /**
     * Any test using RefreshDatabase gets roles/permissions seeded
     * automatically — most feature tests assign a role and would otherwise
     * fail against an empty roles table.
     */
    protected $seed = true;

    protected $seeder = RolesAndPermissionsSeeder::class;

    /**
     * RefreshDatabase drops every table, so refuse to start against anything
     * but a local database server, before any test can touch it.
     * phpunit.xml already blanks DB_URL and DB_URL_UNPOOLED from .env; this
     * also catches exported variables and a DB_HOST that names a hosted
     * server such as Neon. Both the default connection and pgsql_unpooled
     * (where the schema commands go outside the suite) are checked.
     */
    public function createApplication()
    {
        $app = parent::createApplication();

        $config = $app['config'];
        $names = array_unique([$config->get('database.default'), 'pgsql_unpooled']);

        foreach ($names as $name) {
            $connection = $config->get("database.connections.{$name}");

            if (is_array($connection)) {
                static::assertLocalDatabase((new ConfigurationUrlParser)->parseConfiguration($connection), $name);
            }
        }

        return $app;
    }

    /**
     * Loopback addresses, unix sockets and single-label host names (a
     * container's service name) count as local; anything with a dot in it,
     * a Neon host for one, does not. A `direct` endpoint (Laravel's own
     * pooled/direct split) is checked the same way.
     */
    public static function assertLocalDatabase(array $config, string $connection = 'default'): void
    {
        $hosts = array_filter([
            'host' => $config['host'] ?? null,
            'direct host' => $config['direct']['host'] ?? null,
        ]);

        foreach ($hosts as $label => $host) {
            foreach ((array) $host as $value) {
                $value = (string) $value;
                $local = $value === 'localhost'
                    || $value === '::1'
                    || str_starts_with($value, '127.')
                    || str_starts_with($value, '/')
                    || ! str_contains($value, '.');

                if (! $local) {
                    throw new RuntimeException("Refusing to run tests: the [{$connection}] connection's {$label} [{$value}] is not a local database server. Tests drop every table; point DB_* at a throwaway local database.");
                }
            }
        }
    }
}
