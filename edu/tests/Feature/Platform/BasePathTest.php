<?php

namespace Tests\Feature\Platform;

use App\Models\User;
use App\Routing\BasePathRedirector;
use Facades\Livewire\Features\SupportFileUploads\GenerateSignedUploadUrl as SignedUploadUrl;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Redirector;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Livewire\Mechanisms\FrontendAssets\FrontendAssets;
use Tests\TestCase;

/**
 * Serving this app under a sub-path, the way bkesari.com publishes it at
 * `/edu/`.
 *
 * The hub forwards those requests with the prefix removed, because Laravel
 * matches routes against the request path and serves `public/` from this
 * site's own root. So the app receives `/login` and has to answer with URLs
 * that say `/edu/login` — and the tests below ask for the unprefixed path on
 * the prefixed host, which is exactly what arrives in production.
 *
 * Driven by APP_URL having a path, so it is set here before the application
 * boots. The suite's own APP_URL is a bare origin (see phpunit.xml), which is
 * what every other test relies on.
 */
class BasePathTest extends TestCase
{
    use RefreshDatabase;

    private const APP_URL = 'https://dev.bkesari.com/edu';

    private ?string $originalAppUrl = null;

    protected function setUp(): void
    {
        $this->originalAppUrl = $_ENV['APP_URL'] ?? null;

        $_ENV['APP_URL'] = $_SERVER['APP_URL'] = self::APP_URL;
        putenv('APP_URL='.self::APP_URL);

        parent::setUp();
    }

    protected function tearDown(): void
    {
        parent::tearDown();

        // Restored rather than cleared: the rest of the suite runs in this
        // same process and reads the value phpunit.xml set.
        if ($this->originalAppUrl === null) {
            unset($_ENV['APP_URL'], $_SERVER['APP_URL']);
            putenv('APP_URL');
        } else {
            $_ENV['APP_URL'] = $_SERVER['APP_URL'] = $this->originalAppUrl;
            putenv('APP_URL='.$this->originalAppUrl);
        }
    }

    /**
     * Runs the given assertions while the app holds a real request, the way it
     * does when serving a page, rather than the stand-in one Laravel builds
     * from APP_URL for console work.
     */
    private function withRequestTo(string $path, callable $assertions): void
    {
        $this->get('http://dev.bkesari.com'.$path)->assertSuccessful();

        $assertions();
    }

    public function test_the_base_path_comes_from_app_url(): void
    {
        $this->assertSame(self::APP_URL, rtrim(config('app.url'), '/'));
    }

    public function test_named_routes_carry_the_prefix(): void
    {
        $this->assertSame(self::APP_URL.'/login', route('login'));
        $this->assertSame(self::APP_URL, route('home'));
    }

    public function test_relative_route_urls_carry_the_prefix_too(): void
    {
        // The app uses `route(..., absolute: false)` in its redirects, and
        // Livewire's AJAX endpoint is a relative URL as well, so losing the
        // prefix here would send both to the hub.
        //
        // Asserted from inside a request on purpose. A relative URL is built by
        // stripping the request's base path off an absolute one, and outside a
        // request Laravel invents a stand-in request from APP_URL whose base
        // path IS `/edu` — so these come back unprefixed in a queued job and
        // prefixed in a real request. It is the real request that serves pages.
        $this->withRequestTo('/login', function () {
            $this->assertSame('/edu/login', route('login', absolute: false));
            $this->assertSame('/edu/dashboard', route('dashboard', absolute: false));
        });
    }

    public function test_generated_urls_stay_https_even_though_the_hub_forwards_over_http(): void
    {
        // formatRoot() rewrites the forced root's scheme with the request's, so
        // without forceScheme every link on the page would come out as http.
        $url = $this->get('http://dev.bkesari.com/login');
        $url->assertOk();

        $this->assertStringStartsWith('https://dev.bkesari.com/edu/', route('login'));
        $url->assertSee('https://dev.bkesari.com/edu/', false);
    }

    public function test_assets_are_requested_under_the_prefix(): void
    {
        $this->get('http://dev.bkesari.com/login')
            ->assertOk()
            ->assertSee('https://dev.bkesari.com/edu/build/', false);
    }

    public function test_livewires_ajax_endpoint_carries_the_prefix(): void
    {
        // The sign-in form has no action of its own and posts here, so an
        // unprefixed value means nobody can log in. This is the value that
        // reaches the browser, read off the page Livewire actually rendered.
        $this->get('http://dev.bkesari.com/login')
            ->assertOk()
            ->assertSee('data-update-uri="/edu/livewire/update"', false);

        $this->withRequestTo('/login', function () {
            $this->assertSame('/edu/livewire/update', app('livewire')->getUpdateUri());
        });
    }

    public function test_livewires_script_url_carries_the_prefix_and_names_the_served_file(): void
    {
        // This one URL never passes through the URL generator, so it is
        // overridden from the route Livewire registered — which is
        // livewire.js with debug on and livewire.min.js with it off.
        $served = app(FrontendAssets::class)->javaScriptRoute->uri;

        $this->assertSame(self::APP_URL.'/'.ltrim($served, '/'), config('livewire.asset_url'));

        $this->get('http://dev.bkesari.com/login')
            ->assertOk()
            ->assertSee('src="'.self::APP_URL.'/'.ltrim($served, '/'), false);
    }

    public function test_a_guest_is_sent_to_the_prefixed_sign_in_page(): void
    {
        $this->get('http://dev.bkesari.com/dashboard')
            ->assertRedirect(self::APP_URL.'/login');
    }

    public function test_a_guest_redirect_remembers_the_prefixed_page_it_came_from(): void
    {
        // Without this the visitor signs in and lands on the hub, which has no
        // such page, having lost the page they originally asked for.
        $this->get('http://dev.bkesari.com/dashboard');

        $this->assertSame(self::APP_URL.'/dashboard', session('url.intended'));
    }

    public function test_the_remembered_page_keeps_its_query_string(): void
    {
        $this->get('http://dev.bkesari.com/dashboard?tab=identity&page=2');

        $this->assertStringStartsWith(self::APP_URL.'/dashboard?', session('url.intended'));
        $this->assertStringContainsString('tab=identity', session('url.intended'));
        $this->assertStringContainsString('page=2', session('url.intended'));
    }

    public function test_the_redirector_is_replaced_only_when_there_is_a_prefix(): void
    {
        $this->assertInstanceOf(BasePathRedirector::class, app('redirect'));
    }

    public function test_livewire_file_uploads_go_to_one_prefix_and_pass_their_signature_check(): void
    {
        // Every upload (complaint evidence among them) posts to a URL Livewire
        // signs. It used to come out as /edu/edu/livewire/upload-file, and its
        // signature covered a path the app never receives.
        $url = null;
        $this->withRequestTo('/login', function () use (&$url) {
            $url = SignedUploadUrl::forLocal();
        });

        $this->assertStringStartsWith(self::APP_URL.'/livewire/upload-file?', $url);

        // What reaches the app once the hub has taken /edu off.
        Storage::fake('tmp-for-tests'); // Livewire's temporary-upload disk under PHPUnit
        $this->actingAs(User::factory()->create())
            ->post('http://dev.bkesari.com'.Str::after($url, self::APP_URL), [
                'files' => [UploadedFile::fake()->image('evidence.png')],
            ])
            ->assertOk()
            ->assertJsonStructure(['paths']);
    }

    public function test_no_view_hardcodes_a_root_relative_link(): void
    {
        // A literal href="/..." or redirect('/') leaves the tab for the hub,
        // and three of them did exactly that before this was wired up. The
        // generator cannot catch them, so they are caught here.
        $views = base_path('resources/views');
        $hits = [];

        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($views));
        foreach ($files as $file) {
            if ($file->isDir() || ! str_ends_with($file->getFilename(), '.blade.php')) {
                continue;
            }

            $body = file_get_contents($file->getPathname());
            $relative = str_replace($views.'/', '', $file->getPathname());

            if (preg_match('/(?:href|action|src)="\/(?!\/)/', $body)) {
                $hits[] = $relative.' has a root-relative href/action/src';
            }

            if (preg_match('/redirect(?:Route)?\(\s*[\'"]\//', $body)) {
                $hits[] = $relative.' redirects to a literal path';
            }
        }

        $this->assertSame([], $hits, implode("\n", $hits));
    }
}
