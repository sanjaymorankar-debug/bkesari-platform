<?php

use Illuminate\Support\Str;
use Pdo\Pgsql;

// PostgreSQL, as served on every tier by Neon. A Neon database has two
// endpoints: a pooled one (PgBouncer in transaction mode) for the running app,
// and a direct one for schema work. The server's .env names them
//
//   DB_URL           the pooled connection string   -> the app at runtime
//   DB_URL_UNPOOLED  the direct connection string   -> migrations and seeders
//
// Either URL overrides the DB_HOST/DB_PORT/... lines below, so a local
// database needs only those, and DB_URL_UNPOOLED falls back to DB_URL (and that
// to the DB_* lines) when it is not set. App\Providers\DatabaseServiceProvider
// moves `migrate`, `db:seed` and the other schema commands onto the direct
// endpoint; it reads only this file, so it keeps working under config:cache.
$pgsql = [
    'driver' => 'pgsql',
    'url' => env('DB_URL'),
    'host' => env('DB_HOST', '127.0.0.1'),
    'port' => env('DB_PORT', '5432'),
    'database' => env('DB_DATABASE', 'laravel'),
    'username' => env('DB_USERNAME', 'root'),
    'password' => env('DB_PASSWORD', ''),
    // Sent as the client_encoding startup parameter, which a pooler keeps per
    // client, rather than as a SET.
    'charset' => env('DB_CHARSET', 'utf8'),
    'prefix' => '',
    'prefix_indexes' => true,
    // Deliberately no 'search_path', 'timezone', 'isolation_level' or
    // 'synchronous_commit': Laravel applies each of those with a session-level
    // SET straight after connecting, and behind a transaction-mode pooler a
    // session SET lands on whichever server connection ran it, not on the ones
    // the following queries get. The server's own defaults (search_path
    // "$user", public, which resolves to public for this app's role) apply
    // on both endpoints alike. NeonReadinessTest keeps it that way.
    'sslmode' => env('DB_SSLMODE', 'prefer'),
    // Each query goes out as one unnamed extended-protocol statement instead
    // of a named prepared statement. PHP's pdo_pgsql frees a named statement
    // with an SQL `DEALLOCATE`, which a pooler cannot track: the server rejects
    // it, and inside a transaction that error aborts the transaction. Every
    // migration and DB::transaction() failed on Neon's pooled endpoint, and a
    // transaction of a single statement was rolled back while commit()
    // reported success.
    // Laravel never reuses a prepared statement, so nothing is lost, and
    // parameters are still sent separately from the SQL (this is not
    // client-side emulation, which would also break boolean comparisons).
    'options' => extension_loaded('pdo_pgsql') ? [
        (PHP_VERSION_ID >= 80500 ? Pgsql::ATTR_DISABLE_PREPARES : PDO::PGSQL_ATTR_DISABLE_PREPARES) => true,
    ] : [],
];

return [

    /*
    |--------------------------------------------------------------------------
    | Default Database Connection Name
    |--------------------------------------------------------------------------
    |
    | Here you may specify which of the database connections below you wish
    | to use as your default connection for database operations. This is
    | the connection which will be utilized unless another connection
    | is explicitly specified when you execute a query / statement.
    |
    */

    'default' => env('DB_CONNECTION', 'pgsql'),

    /*
    |--------------------------------------------------------------------------
    | Database Connections
    |--------------------------------------------------------------------------
    |
    | Below are all of the database connections defined for your application.
    | An example configuration is provided for each database system which
    | is supported by Laravel. You're free to add / remove connections.
    |
    */

    'connections' => [

        // PostgreSQL is the only supported database for development, staging
        // and production. SQLite is kept solely so the test suite can still
        // run against an in-memory database with zero setup (see phpunit.xml);
        // CI runs the same suite against PostgreSQL.
        'sqlite' => [
            'driver' => 'sqlite',
            'url' => env('DB_URL'),
            'database' => env('DB_DATABASE', database_path('database.sqlite')),
            'prefix' => '',
            'foreign_key_constraints' => env('DB_FOREIGN_KEYS', true),
            'busy_timeout' => null,
            'journal_mode' => null,
            'synchronous' => null,
            'transaction_mode' => 'DEFERRED',
        ],

        // The app at runtime: Neon's pooled endpoint.
        'pgsql' => $pgsql,

        // The same database over Neon's direct endpoint, for schema work and
        // anything else that needs a session of its own. Use it explicitly
        // with `--database=pgsql_unpooled` or DB::connection('pgsql_unpooled').
        'pgsql_unpooled' => array_merge($pgsql, [
            'url' => env('DB_URL_UNPOOLED') ?: env('DB_URL'),
        ]),

    ],

    /*
    |--------------------------------------------------------------------------
    | Migration Repository Table
    |--------------------------------------------------------------------------
    |
    | This table keeps track of all the migrations that have already run for
    | your application. Using this information, we can determine which of
    | the migrations on disk haven't actually been run on the database.
    |
    */

    'migrations' => [
        'table' => 'migrations',
        'update_date_on_publish' => true,
    ],

    /*
    |--------------------------------------------------------------------------
    | Redis Databases
    |--------------------------------------------------------------------------
    |
    | Redis is an open source, fast, and advanced key-value store that also
    | provides a richer body of commands than a typical key-value system
    | such as Memcached. You may define your connection settings here.
    |
    */

    'redis' => [

        'client' => env('REDIS_CLIENT', 'phpredis'),

        'options' => [
            'cluster' => env('REDIS_CLUSTER', 'redis'),
            'prefix' => env('REDIS_PREFIX', Str::slug((string) env('APP_NAME', 'laravel')).'-database-'),
            'persistent' => env('REDIS_PERSISTENT', false),
        ],

        'default' => [
            'url' => env('REDIS_URL'),
            'host' => env('REDIS_HOST', '127.0.0.1'),
            'username' => env('REDIS_USERNAME'),
            'password' => env('REDIS_PASSWORD'),
            'port' => env('REDIS_PORT', '6379'),
            'database' => env('REDIS_DB', '0'),
            'max_retries' => env('REDIS_MAX_RETRIES', 3),
            'backoff_algorithm' => env('REDIS_BACKOFF_ALGORITHM', 'decorrelated_jitter'),
            'backoff_base' => env('REDIS_BACKOFF_BASE', 100),
            'backoff_cap' => env('REDIS_BACKOFF_CAP', 1000),
        ],

        'cache' => [
            'url' => env('REDIS_URL'),
            'host' => env('REDIS_HOST', '127.0.0.1'),
            'username' => env('REDIS_USERNAME'),
            'password' => env('REDIS_PASSWORD'),
            'port' => env('REDIS_PORT', '6379'),
            'database' => env('REDIS_CACHE_DB', '1'),
            'max_retries' => env('REDIS_MAX_RETRIES', 3),
            'backoff_algorithm' => env('REDIS_BACKOFF_ALGORITHM', 'decorrelated_jitter'),
            'backoff_base' => env('REDIS_BACKOFF_BASE', 100),
            'backoff_cap' => env('REDIS_BACKOFF_CAP', 1000),
        ],

    ],

];
