<?php

namespace Tests\Feature\Platform;

use App\Http\Middleware\TrustHubProxy;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;
use Mockery;
use ReflectionProperty;
use Tests\TestCase;

/**
 * Whose forwarded headers are believed (D-038, App\Http\Middleware\TrustHubProxy):
 * only the hub's, which carry HUB_PROXY_SECRET, so a client reaching this site
 * directly cannot choose the address the rate limits count.
 */
class TrustHubProxyTest extends TestCase
{
    private const SECRET = 'test-only-proxy-secret-0123456789abcdef';

    protected function setUp(): void
    {
        parent::setUp();
        Route::get('/__client', fn () => response()->json([
            'ip' => request()->ip(),
            'secure' => request()->secure(),
            'proxyHeader' => request()->headers->get('X-Bkesari-Proxy'),
        ]));
    }

    private function client(array $headers, ?string $secret = self::SECRET): array
    {
        config(['services.hub.proxy_secret' => (string) $secret]);

        return $this->withServerVariables(['REMOTE_ADDR' => '10.0.0.5'])
            ->withHeaders($headers)
            ->get('/__client')
            ->assertOk()
            ->json();
    }

    public function test_the_hub_with_its_secret_is_believed(): void
    {
        $seen = $this->client(['X-Forwarded-For' => '198.51.100.7', 'X-Forwarded-Proto' => 'https', 'X-Bkesari-Proxy' => self::SECRET]);

        $this->assertSame('198.51.100.7', $seen['ip']);
        $this->assertTrue($seen['secure']);
        $this->assertNull($seen['proxyHeader'], 'the secret never reaches the app');
    }

    public function test_anyone_else_is_taken_as_the_request_arrived(): void
    {
        foreach ([['X-Bkesari-Proxy' => 'a-guess'], ['X-Bkesari-Proxy' => ''], []] as $extra) {
            $seen = $this->client(['X-Forwarded-For' => '198.51.100.7', 'X-Forwarded-Proto' => 'https'] + $extra);
            $this->assertSame('10.0.0.5', $seen['ip'], json_encode($extra));
            $this->assertFalse($seen['secure']);
        }
    }

    public function test_a_forged_chain_through_the_hub_still_gives_the_address_the_hub_sent(): void
    {
        // The hub sends one address; were a chain to arrive, only the hub is trusted.
        $seen = $this->client(['X-Forwarded-For' => '203.0.113.9, 198.51.100.7', 'X-Bkesari-Proxy' => self::SECRET]);

        $this->assertSame('198.51.100.7', $seen['ip']);
    }

    public function test_with_no_secret_configured_every_proxy_is_trusted_as_before(): void
    {
        $seen = $this->client(['X-Forwarded-For' => '198.51.100.7'], secret: null);

        $this->assertSame('198.51.100.7', $seen['ip']);
    }

    public function test_with_no_secret_the_warning_is_written_once_a_day_not_on_every_request(): void
    {
        Log::spy();
        Cache::forget('trust-hub-proxy:no-secret-warned'); // whatever store the run uses
        $warned = new ReflectionProperty(TrustHubProxy::class, 'warned');
        $request = function () use ($warned) {
            // Under PHP-FPM and `php artisan serve` every request starts with fresh
            // static state, so a flag on the class alone would warn every time.
            $warned->setValue(null, false);
            $this->client(['X-Forwarded-For' => '198.51.100.7'], secret: null);
        };

        $request();
        $request();
        $request();
        Log::shouldHaveReceived('warning')->with(Mockery::pattern('/HUB_PROXY_SECRET is not set/'))->once();

        // And again the next day, so a tier left without it is not forgotten.
        $this->travel(25)->hours();
        $request();
        Log::shouldHaveReceived('warning')->with(Mockery::pattern('/HUB_PROXY_SECRET is not set/'))->twice();
    }
}
