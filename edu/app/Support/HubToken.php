<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * The bkesari.com hub forwards every /edu/ request with X-Bkesari-Token: an
 * RS256 JWT valid for 60 seconds with `sub` (the bkesari ID), `email`, `role`
 * (the Education role the hub granted) and `aud` = 'edu'. It is checked here
 * against the hub's published key set (HUB_JWKS_URL); no secret is shared.
 */
class HubToken
{
    public const HEADER = 'X-Bkesari-Token';

    public const AUDIENCE = 'edu';

    /** @return array<string, mixed> the verified claims */
    public static function verify(string $token, array $jwks, ?int $now = null): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new RuntimeException('malformed token');
        }
        [$h, $p, $s] = $parts;
        $header = json_decode(self::b64($h), true);
        $claims = json_decode(self::b64($p), true);
        if (! is_array($header) || ! is_array($claims)) {
            throw new RuntimeException('malformed token');
        }
        $jwk = collect($jwks['keys'] ?? [])->firstWhere('kid', $header['kid'] ?? null);
        if (($header['alg'] ?? null) !== 'RS256' || ! $jwk) {
            throw new RuntimeException('unknown key');
        }
        $ok = openssl_verify("$h.$p", self::b64($s), self::pem($jwk['n'], $jwk['e']), OPENSSL_ALGO_SHA256);
        if ($ok !== 1) {
            throw new RuntimeException('bad signature');
        }
        if (($claims['exp'] ?? 0) < ($now ?? time())) {
            throw new RuntimeException('token expired');
        }
        if (($claims['aud'] ?? null) !== self::AUDIENCE) {
            throw new RuntimeException('token is for another project');
        }
        if (empty($claims['sub']) || empty($claims['email'])) {
            throw new RuntimeException('token has no user');
        }

        return $claims;
    }

    /**
     * The hub's key set: HUB_JWKS (the JSON itself) when set, else fetched from
     * HUB_JWKS_URL and cached for five minutes. Inline is preferred on shared
     * hosting, where an outbound lookup can hang on DNS; a failed fetch is
     * remembered for a minute so it cannot stall every request.
     */
    public static function jwks(): array
    {
        $inline = config('services.hub.jwks');
        if ($inline) {
            $keys = json_decode($inline, true);
            if (! is_array($keys) || empty($keys['keys'])) {
                throw new RuntimeException('HUB_JWKS is not a JSON key set');
            }

            return $keys;
        }
        $url = config('services.hub.jwks_url');
        if (! $url) {
            throw new RuntimeException('Neither HUB_JWKS nor HUB_JWKS_URL is set');
        }
        if (Cache::get('hub-jwks-failed')) {
            throw new RuntimeException('the hub key set was unreachable a moment ago');
        }
        try {
            return Cache::remember('hub-jwks', 300, fn () => Http::timeout(5)->get($url)->throw()->json());
        } catch (\Throwable $e) {
            Cache::put('hub-jwks-failed', true, 60);
            throw new RuntimeException('the hub key set could not be fetched: '.$e->getMessage());
        }
    }

    private static function b64(string $v): string
    {
        return base64_decode(strtr($v, '-_', '+/').str_repeat('=', (4 - strlen($v) % 4) % 4));
    }

    /** An RSA public key in PEM, from a JWK's modulus and exponent. */
    private static function pem(string $n, string $e): string
    {
        $int = function (string $bytes): string {
            if (ord($bytes[0]) > 0x7F) {
                $bytes = "\x00".$bytes;
            }

            return "\x02".self::len(strlen($bytes)).$bytes;
        };
        $rsa = $int(self::b64($n)).$int(self::b64($e));
        $rsa = "\x30".self::len(strlen($rsa)).$rsa;
        $bits = "\x03".self::len(strlen($rsa) + 1)."\x00".$rsa;
        $alg = "\x30\x0d\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01\x05\x00";
        $spki = "\x30".self::len(strlen($alg.$bits)).$alg.$bits;

        return "-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($spki), 64, "\n")."-----END PUBLIC KEY-----\n";
    }

    private static function len(int $n): string
    {
        if ($n < 0x80) {
            return chr($n);
        }
        $out = ltrim(pack('N', $n), "\x00");

        return chr(0x80 | strlen($out)).$out;
    }
}
