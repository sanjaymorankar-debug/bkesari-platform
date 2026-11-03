<?php

namespace Tests\Feature\Platform;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * English, Marathi and Hindi, chosen in the bkesari shell (the k_lang cookie)
 * and rendered by the server (App\Http\Middleware\SetLocale).
 */
class LanguageTest extends TestCase
{
    use RefreshDatabase;

    public function test_english_is_the_default(): void
    {
        $this->get('/login')->assertOk()
            ->assertSee('<html lang="en"', false)
            ->assertSee('This is a separate account for Education.');
    }

    public function test_the_shell_cookie_picks_marathi_or_hindi(): void
    {
        // Sent as the browser writes it: plain text. The cookie is excluded
        // from Laravel's cookie encryption, or this would read as tampered.
        $this->withUnencryptedCookie('k_lang', 'mr')->get('/login')->assertOk()
            ->assertSee('<html lang="mr"', false)
            ->assertSee('हे Education साठी स्वतंत्र खाते आहे.')
            ->assertSee('मोबाइल नंबर');

        $this->withUnencryptedCookie('k_lang', 'hi')->get('/')->assertOk()
            ->assertSee('<html lang="hi"', false)
            ->assertSee('अपने स्कूल को जानिए।');
    }

    public function test_anything_else_falls_back_to_english(): void
    {
        foreach (['fr', 'marathi', '', '<script>'] as $value) {
            $this->withUnencryptedCookie('k_lang', $value)->get('/login')->assertOk()->assertSee('<html lang="en"', false);
        }
    }

    public function test_the_shell_account_links_follow_the_language(): void
    {
        $this->actingAs(User::factory()->create())
            ->withUnencryptedCookie('k_lang', 'hi')
            ->withCredentials()
            ->getJson('/shell/me')
            ->assertJsonPath('links.0.label', 'प्रोफ़ाइल')
            ->assertJsonPath('links.1.label', 'डैशबोर्ड');
    }

    public function test_the_three_dictionaries_have_the_same_strings_and_placeholders(): void
    {
        $en = json_decode(file_get_contents(lang_path('en.json')), true, flags: JSON_THROW_ON_ERROR);

        foreach (['mr', 'hi'] as $locale) {
            $other = json_decode(file_get_contents(lang_path("{$locale}.json")), true, flags: JSON_THROW_ON_ERROR);
            $this->assertSame(array_keys($en), array_keys($other), "{$locale}.json must carry exactly the strings of en.json");

            foreach ($other as $key => $text) {
                $this->assertNotSame('', trim($text), "{$locale}: '{$key}' is empty");
                preg_match_all('/:[a-z]+/', $key, $want);
                foreach (array_unique($want[0]) as $placeholder) {
                    $this->assertStringContainsString($placeholder, $text, "{$locale}: '{$key}' lost {$placeholder}");
                }
                $this->assertSame(substr_count($key, '|'), substr_count($text, '|'), "{$locale}: '{$key}' has the wrong number of plural forms");
            }
        }
    }
}
