<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * The hub's built-in administrators sign in here as <name>@builtin.bkesari.com
 * (App\Http\Middleware\HubSignIn::BUILTIN_ADMINS). HubSignIn never links one of
 * them to an account someone else made with that address, so such an account
 * would only lock the administrator out. Nobody may give an account, a staff
 * member, a child or an invitation an address in that domain.
 */
class NotReservedEmail implements ValidationRule
{
    public const DOMAIN = 'builtin.bkesari.com';

    /**
     * Lowercased the way PostgreSQL's citext compares (lower(): the simple Unicode
     * mapping), not mb_strtolower's full one: under the simple mapping İ (U+0130)
     * is a plain i, so "bu\u{0130}ltin.bkesari.com" is the reserved domain there.
     */
    public static function isReserved(?string $email): bool
    {
        return $email !== null && str_ends_with(mb_convert_case(trim($email), MB_CASE_LOWER_SIMPLE), '@'.self::DOMAIN);
    }

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (is_string($value) && self::isReserved($value)) {
            $fail(__('This email address is reserved.'));
        }
    }
}
