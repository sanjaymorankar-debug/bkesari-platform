<?php

namespace App\Database;

use Illuminate\Database\Connectors\PostgresConnector as BaseConnector;
use InvalidArgumentException;

/**
 * Laravel's PostgreSQL connector, plus `channel_binding`.
 *
 * Neon's connection strings end in `?sslmode=require&channel_binding=require`.
 * Laravel turns every query parameter of DB_URL into a connection option, but
 * only passes sslmode, sslcert, sslkey and sslrootcert on to libpq, so
 * channel_binding was dropped without a word and the connection quietly fell
 * back to libpq's default (prefer). This hands it on, so a URL copied from the
 * Neon console means what it says.
 *
 * Bound as `db.connector.pgsql` in DatabaseServiceProvider, which is the hook
 * Laravel's ConnectionFactory checks before using its own connector.
 */
class PostgresConnector extends BaseConnector
{
    private const CHANNEL_BINDING = ['disable', 'prefer', 'require'];

    /**
     * @param  string  $dsn
     * @return string
     */
    protected function addSslOptions($dsn, array $config)
    {
        $dsn = parent::addSslOptions($dsn, $config);

        if (isset($config['channel_binding'])) {
            // Checked rather than copied, because the value is written into the
            // DSN as it stands and anything else would be a typo that libpq
            // reports far less clearly.
            if (! in_array($config['channel_binding'], self::CHANNEL_BINDING, true)) {
                throw new InvalidArgumentException(
                    'channel_binding must be one of '.implode(', ', self::CHANNEL_BINDING)
                    .", not '{$config['channel_binding']}'."
                );
            }

            $dsn .= ";channel_binding={$config['channel_binding']}";
        }

        return $dsn;
    }
}
