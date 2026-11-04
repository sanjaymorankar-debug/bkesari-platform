<?php

namespace Tests\Feature\Auth;

use App\Mail\SignInCodeMail;
use App\Models\TwoFactorAuthentication;
use App\Models\User;
use App\Services\EmailSignIn;
use Closure;
use Illuminate\Cache\RateLimiter;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter as RateLimiterFacade;
use Livewire\Volt\Volt;
use Mockery;
use PragmaRX\Google2FA\Google2FA;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Symfony\Component\Mime\Email;
use Tests\TestCase;

/**
 * Signing in with a six-digit code sent by email (App\Services\EmailSignIn),
 * next to the password. SMS is on hold, so this is the code people get.
 *
 * Mail goes through the app's real mailer to a transport that keeps each
 * message here instead of handing it to Hostinger's SMTP: it counts as a mail
 * server (it is neither `log` nor `array`), and the tests read the code out
 * of the message the person would get. The cases with no mail server switch
 * the mailer to `log` or `array`, and APP_ENV per test.
 */
class EmailSignInTest extends TestCase
{
    use RefreshDatabase;

    private const EMAIL = 'asha@example.com';

    /** @var list<Email> what the mail server was handed */
    private array $delivered = [];

    /** When true, the mail server refuses every message. */
    private bool $mailFails = false;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.sms.webhook_url' => null, 'services.sms.webhook_token' => null]);
        Cache::flush();

        $deliver = function (SentMessage $message) {
            if ($this->mailFails) {
                throw new TransportException('Connection could not be established with host "ssl://smtp.hostinger.com:465".');
            }
            $this->delivered[] = $message->getOriginalMessage();
        };
        Mail::extend('capture', fn () => new class($deliver) extends AbstractTransport
        {
            public function __construct(private Closure $deliver)
            {
                parent::__construct();
            }

            protected function doSend(SentMessage $message): void
            {
                ($this->deliver)($message);
            }

            public function __toString(): string
            {
                return 'capture://';
            }
        });
        config([
            'mail.mailers.capture' => ['transport' => 'capture'],
            'mail.default' => 'capture',
            'mail.from' => ['address' => 'no-reply@bkesari.com', 'name' => 'Education · bkesari'],
        ]);
    }

    private function asha(): User
    {
        return User::factory()->create(['name' => 'Asha Patil', 'email' => self::EMAIL]);
    }

    private function askForCode(string $typed = self::EMAIL)
    {
        return Volt::test('pages.auth.login')
            ->call('useMethod', 'code')
            ->set('codeEmail', $typed)
            ->call('sendEmailCode');
    }

    /** The code in the last email the mail server was handed, read as the person would. */
    private function emailedCode(): ?string
    {
        $mail = end($this->delivered);

        return $mail && preg_match('/^(\d{6})$/m', (string) $mail->getTextBody(), $m) ? $m[1] : null;
    }

    private function codeKey(string $email = self::EMAIL): string
    {
        return 'email-sign-in:code:'.hash('sha256', $email);
    }

    public function test_the_sign_in_screen_starts_with_an_emailed_code_where_mail_is_delivered(): void
    {
        Volt::test('pages.auth.login')->assertSet('method', 'code')
            ->assertSee('Email me a code')->assertSee('We will email a 6-digit code to this address. It works for 10 minutes.');

        config(['mail.default' => 'log']);
        Volt::test('pages.auth.login')->assertSet('method', 'password');
    }

    public function test_only_a_mailer_that_delivers_counts_as_a_mail_server(): void
    {
        foreach (['smtp', 'sendmail', 'capture'] as $mailer) {
            config(['mail.default' => $mailer]);
            $this->assertSame(EmailSignIn::MODE_MAIL, app(EmailSignIn::class)->mode(), $mailer);
        }
        foreach (['log', 'array', 'no-such-mailer'] as $mailer) {
            config(['mail.default' => $mailer]);
            $this->assertSame(EmailSignIn::MODE_OFF, app(EmailSignIn::class)->mode(), $mailer);
        }
    }

    public function test_a_code_is_emailed_and_signs_the_account_in(): void
    {
        $asha = $this->asha();

        $component = $this->askForCode('  Asha@Example.COM ')
            ->assertHasNoErrors()
            ->assertSet('emailSentTo', self::EMAIL)
            ->assertSet('shownEmailCode', null)
            ->assertSee('Enter the 6-digit code we sent to asha@example.com.')
            ->assertDontSee('Development only.');

        $this->assertCount(1, $this->delivered);
        $this->assertSame(self::EMAIL, $this->delivered[0]->getTo()[0]->getAddress());
        $code = $this->emailedCode();
        $this->assertMatchesRegularExpression('/^\d{6}$/', (string) $code);
        $component->assertDontSee($code);

        $component->set('emailCode', $code)->call('verifyEmailCode')
            ->assertHasNoErrors()
            ->assertRedirect(route('dashboard', absolute: false));

        $this->assertAuthenticatedAs($asha);
    }

    public function test_the_email_gives_the_code_and_says_what_it_is_for(): void
    {
        $this->asha();
        $this->askForCode()->assertHasNoErrors();

        $mail = $this->delivered[0];
        $from = $mail->getFrom()[0];
        $this->assertSame(['no-reply@bkesari.com', 'Education · bkesari'], [$from->getAddress(), $from->getName()]);
        $this->assertSame('Asha Patil', $mail->getTo()[0]->getName());
        $this->assertSame('Your Education sign-in code', $mail->getSubject());

        $code = $this->emailedCode();
        foreach ([(string) $mail->getTextBody(), html_entity_decode((string) $mail->getHtmlBody(), ENT_QUOTES)] as $body) {
            $this->assertStringContainsString($code, $body);
            $this->assertStringContainsString('It works once, for 10 minutes. Do not share it with anyone.', $body);
            $this->assertStringContainsString('This is a separate account for Education.', $body);
            $this->assertStringContainsString("If you didn't ask for this, ignore this email.", $body);
        }
        // The plain-text part is not HTML-escaped.
        $this->assertStringNotContainsString('&#039;', (string) $mail->getTextBody());
        $this->assertStringContainsString('<html lang="en">', (string) $mail->getHtmlBody());
    }

    public function test_the_email_is_in_the_language_of_the_page(): void
    {
        $this->asha();
        $expected = [
            'mr' => ['तुमचा Education साइन-इन कोड', 'तो एकदाच, १० मिनिटांसाठी चालतो.', 'हे Education साठी स्वतंत्र खाते आहे.', 'तुम्ही हा कोड मागितला नसेल, तर या ईमेलकडे दुर्लक्ष करा.'],
            'hi' => ['आपका Education साइन-इन कोड', 'यह एक बार, 10 मिनट तक मान्य है।', 'यह Education के लिए अलग खाता है।', 'अगर आपने यह नहीं माँगा था, तो इस ईमेल को अनदेखा करें।'],
        ];

        foreach ($expected as $locale => [$subject, $validity, $separate, $ignore]) {
            Cache::flush();
            $this->delivered = [];
            // What App\Http\Middleware\SetLocale does with the shell's k_lang cookie.
            app()->setLocale($locale);
            $this->askForCode()->assertHasNoErrors();

            $mail = $this->delivered[0];
            $this->assertSame($subject, $mail->getSubject(), $locale);
            $this->assertStringContainsString('<html lang="'.$locale.'">', (string) $mail->getHtmlBody());
            foreach ([$validity, $separate, $ignore, $this->emailedCode()] as $line) {
                $this->assertStringContainsString($line, (string) $mail->getTextBody(), $locale);
            }
        }
    }

    public function test_the_code_is_kept_only_as_a_hash(): void
    {
        $this->asha();
        $this->askForCode();
        $code = $this->emailedCode();

        $entry = Cache::get($this->codeKey());
        $this->assertIsArray($entry);
        $this->assertStringNotContainsString($code, json_encode($entry));
        $this->assertTrue(Hash::check($code, $entry['hash']));
        $this->assertStringNotContainsString('asha', $this->codeKey());
    }

    public function test_a_code_works_once(): void
    {
        $this->asha();
        $this->askForCode();
        $code = $this->emailedCode();

        $service = app(EmailSignIn::class);
        $this->assertSame('ok', $service->verify(self::EMAIL, $code)['status']);
        $this->assertSame('expired', $service->verify(self::EMAIL, $code)['status']);
    }

    public function test_a_code_expires_after_ten_minutes(): void
    {
        $this->asha();
        $component = $this->askForCode();
        $code = $this->emailedCode();

        $this->travel(10)->minutes();
        $this->travel(1)->seconds();

        $component->set('emailCode', $code)->call('verifyEmailCode')->assertHasErrors('emailCode')
            ->assertSee('That code has expired or was never sent.');
        $this->assertGuest();
    }

    public function test_five_wrong_codes_throw_the_code_away(): void
    {
        $this->asha();
        $component = $this->askForCode();
        $code = $this->emailedCode();
        $wrong = $code === '000000' ? '111111' : '000000';

        foreach ([4, 3, 2, 1] as $left) {
            $component->set('emailCode', $wrong)->call('verifyEmailCode')->assertHasErrors('emailCode')
                ->assertSee($left === 1 ? '1 try left' : "{$left} tries left");
        }
        $component->set('emailCode', $wrong)->call('verifyEmailCode')->assertSee('Too many wrong codes. Ask for a new code.');

        // The right code is no use now: the code itself is gone.
        $component->set('emailCode', $code)->call('verifyEmailCode')->assertHasErrors('emailCode');
        $this->assertNull(Cache::get($this->codeKey()));
        $this->assertGuest();
    }

    public function test_a_code_stops_working_when_the_account_changes_its_email(): void
    {
        $asha = $this->asha();
        $this->askForCode();
        $code = $this->emailedCode();

        $asha->update(['email' => 'asha.patil@example.com']);

        $this->assertSame('expired', app(EmailSignIn::class)->verify(self::EMAIL, $code)['status']);
    }

    public function test_sending_is_rate_limited_per_email_however_it_is_typed(): void
    {
        $this->asha();

        foreach (['asha@example.com', 'Asha@Example.com', ' ASHA@EXAMPLE.COM '] as $typed) {
            $this->askForCode($typed)->assertHasNoErrors();
        }
        $this->askForCode()->assertHasErrors('codeEmail')->assertSee('Too many codes asked for.')
            ->assertSee('or sign in with your password.')->assertSet('emailSentTo', '');
        $this->assertCount(EmailSignIn::SENDS_PER_EMAIL, $this->delivered);

        $this->travel(EmailSignIn::SEND_WINDOW_SECONDS + 1)->seconds();
        $this->askForCode()->assertHasNoErrors();
        $this->assertCount(EmailSignIn::SENDS_PER_EMAIL + 1, $this->delivered);
    }

    public function test_sending_is_rate_limited_per_address(): void
    {
        $service = app(EmailSignIn::class);
        foreach (range(1, EmailSignIn::SENDS_PER_ADDRESS) as $i) {
            $this->assertSame('sent', $service->send("someone{$i}@example.com", '203.0.113.9')['status']);
        }

        $this->assertSame('throttled', $service->send('another@example.com', '203.0.113.9')['status']);
        $this->assertSame('sent', $service->send('another@example.com', '203.0.113.10')['status']);
    }

    public function test_an_unknown_email_gets_the_same_answer_and_no_mail(): void
    {
        $this->asha();
        $known = $this->askForCode()->assertHasNoErrors();
        $unknown = $this->askForCode('nobody@example.com')->assertHasNoErrors();

        foreach ([$known, $unknown] as $component) {
            $component->assertSet('shownEmailCode', null)
                ->assertSee('If no account uses this email, no code is sent.')
                ->assertSee('Send a new code');
        }
        $unknown->assertSet('emailSentTo', 'nobody@example.com')->assertSee('we sent to nobody@example.com.');

        $this->assertCount(1, $this->delivered);
        $this->assertSame(self::EMAIL, $this->delivered[0]->getTo()[0]->getAddress());
        $this->assertNull(Cache::get($this->codeKey('nobody@example.com')));
    }

    public function test_an_address_that_is_not_an_email_is_refused(): void
    {
        $this->askForCode('not-an-email')->assertHasErrors('codeEmail')->assertSee('Enter a valid email address.')->assertSet('emailSentTo', '');
        $this->askForCode('')->assertHasErrors('codeEmail')->assertSee('Enter your email address.');
        $this->assertSame([], $this->delivered);
    }

    public function test_a_mail_failure_is_reported_and_leaves_no_code(): void
    {
        $this->mailFails = true;
        $this->asha();

        $this->askForCode()->assertHasErrors('codeEmail')
            ->assertSee('We could not send the email just now. Try again in a minute, or sign in with your password.')
            ->assertSet('emailSentTo', '')->assertSet('shownEmailCode', null);
        $this->assertNull(Cache::get($this->codeKey()));
    }

    public function test_on_test_and_production_with_no_mail_server_no_code_is_made_or_shown(): void
    {
        $this->asha();

        foreach (['test', 'production', 'testing', 'staging'] as $env) {
            foreach (['log', 'array'] as $mailer) {
                $this->app['env'] = $env;
                config(['mail.default' => $mailer]);
                Cache::flush();

                $this->assertSame(EmailSignIn::MODE_OFF, app(EmailSignIn::class)->mode(), "{$env}/{$mailer}");
                Volt::test('pages.auth.login')->assertSet('method', 'password')
                    ->call('useMethod', 'code')->set('codeEmail', self::EMAIL)->call('sendEmailCode')
                    ->assertHasErrors('codeEmail')
                    ->assertSee('We could not send a code by email. Sign in with your password instead.')
                    ->assertSee('Sign in with your password')
                    ->assertSet('emailSentTo', '')->assertSet('shownEmailCode', null)
                    ->assertDontSee('Development only.');
                $this->assertNull(Cache::get($this->codeKey()), "{$env}/{$mailer}");
            }
        }
        $this->assertSame([], $this->delivered);
    }

    public function test_on_test_and_production_the_code_is_emailed_and_never_shown(): void
    {
        $this->asha();

        foreach (['test', 'production'] as $env) {
            $this->app['env'] = $env;
            Cache::flush();

            $component = $this->askForCode()->assertHasNoErrors()->assertSet('shownEmailCode', null)->assertDontSee('Development only.');
            $component->assertDontSee($this->emailedCode());
        }
        $this->assertCount(2, $this->delivered);
    }

    public function test_on_dev_the_code_is_shown_only_when_no_mail_server_is_set_up(): void
    {
        $asha = $this->asha();

        // dev (devedu.bkesari.com) with a mail server: emailed, not shown.
        $this->app['env'] = 'dev';
        $this->askForCode()->assertSet('shownEmailCode', null)->assertDontSee('Development only.');
        $this->assertCount(1, $this->delivered);

        // dev and local with no mail server: shown on the page, nothing sent.
        config(['mail.default' => 'log']);
        foreach (['dev', 'local'] as $env) {
            $this->app['env'] = $env;
            Cache::flush();
            $this->assertSame(EmailSignIn::MODE_SCREEN, app(EmailSignIn::class)->mode(), $env);

            $component = $this->askForCode()->assertHasNoErrors();
            $code = $component->get('shownEmailCode');
            $this->assertMatchesRegularExpression('/^\d{6}$/', (string) $code, $env);
            $component->assertSee('Development only.')
                ->assertSee('No mail server is set up, so the code is shown here instead: '.$code);
            $this->assertTrue(Hash::check($code, Cache::get($this->codeKey())['hash']));
        }
        $this->assertCount(1, $this->delivered);

        $component->set('emailCode', $code)->call('verifyEmailCode')->assertRedirect(route('dashboard', absolute: false));
        $this->assertAuthenticatedAs($asha);
    }

    public function test_an_account_with_two_factor_still_has_to_pass_it(): void
    {
        $officer = $this->asha();
        $officer->assignRole('district_officer');
        TwoFactorAuthentication::create([
            'user_id' => $officer->id, 'secret' => (new Google2FA)->generateSecretKey(), 'confirmed_at' => now(),
            'recovery_codes' => ['AAAA-BBBB'],
        ]);

        $component = $this->askForCode();
        $component->set('emailCode', $this->emailedCode())->call('verifyEmailCode')
            ->assertRedirect(route('two-factor.challenge', absolute: false));

        $this->assertGuest();
        $this->assertSame($officer->id, session('2fa_user_id'));
        $this->assertFalse(session('2fa_remember'));
    }

    /**
     * Runs $request $times as if every one of them arrived at the same moment:
     * each reads the code entry as it was before any of them wrote to it,
     * which is what requests racing each other on a tier see.
     */
    private function atOnce(int $times, callable $request): array
    {
        $before = Cache::get($this->codeKey());

        return array_map(function (int $i) use ($before, $request) {
            Cache::put($this->codeKey(), $before, EmailSignIn::CODE_TTL_SECONDS);

            return $request($i);
        }, range(1, $times));
    }

    public function test_wrong_codes_sent_together_still_get_only_five_tries(): void
    {
        $this->asha();
        $this->askForCode();
        $code = $this->emailedCode();
        $wrong = $code === '000000' ? '111111' : '000000';
        $service = app(EmailSignIn::class);

        // Twelve wrong codes and, last, the right one, all at once: only five
        // are ever checked, so the right one is no use either.
        $statuses = $this->atOnce(13, fn (int $i) => $service->verify(self::EMAIL, $i === 13 ? $code : $wrong)['status']);

        $this->assertSame([...array_fill(0, 4, 'wrong'), ...array_fill(0, 9, 'locked')], $statuses);
        $this->assertGuest();
    }

    public function test_a_code_carried_by_several_requests_at_once_signs_in_once(): void
    {
        $this->asha();
        $this->askForCode();
        $code = $this->emailedCode();
        $service = app(EmailSignIn::class);

        $this->assertSame(['ok', 'expired', 'expired'], $this->atOnce(3, fn () => $service->verify(self::EMAIL, $code)['status']));
    }

    public function test_codes_asked_for_together_still_stop_at_the_limit(): void
    {
        $this->asha();
        // Requests that arrive together all pass the limiter's check before
        // any of them has been counted.
        $limiter = Mockery::mock(RateLimiter::class, [app('cache')->driver(config('cache.limiter'))])->makePartial();
        $limiter->shouldReceive('tooManyAttempts')->andReturnFalse();
        RateLimiterFacade::swap($limiter);

        $statuses = array_map(fn (int $i) => app(EmailSignIn::class)->send(self::EMAIL, "203.0.113.{$i}")['status'], range(1, 6));

        $this->assertSame(['sent', 'sent', 'sent', 'throttled', 'throttled', 'throttled'], $statuses);
        $this->assertCount(3, $this->delivered);
    }

    public function test_the_mail_is_sent_at_once_not_queued(): void
    {
        $this->assertNotInstanceOf(ShouldQueue::class, new SignInCodeMail('123456'));
    }
}
