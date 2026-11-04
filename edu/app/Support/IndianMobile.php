<?php

namespace App\Support;

/**
 * Indian mobile numbers, as people type them and as the app stores them.
 *
 * People write 98765 43210, 098765-43210, +91 98765 43210 or 919876543210;
 * all of them are the one number +919876543210, which is how it is stored
 * (users.mobile) and how it is sent to the SMS provider. A number is ten
 * digits starting 6 to 9, the range TRAI assigns to mobiles.
 */
final class IndianMobile
{
    /** The number as +91 and ten digits, or null when it is not an Indian mobile number. */
    public static function normalize(?string $input): ?string
    {
        $digits = preg_replace('/\D+/', '', (string) $input);

        if (strlen($digits) === 12 && str_starts_with($digits, '91')) {
            $digits = substr($digits, 2);
        } elseif (strlen($digits) === 11 && str_starts_with($digits, '0')) {
            $digits = substr($digits, 1);
        }

        return preg_match('/^[6-9]\d{9}$/', $digits) === 1 ? '+91'.$digits : null;
    }

    /** "+91 ••••• •3210" (with no-break spaces): enough to recognise, not enough to copy. */
    public static function mask(string $normalized): string
    {
        return "+91\u{00A0}•••••\u{00A0}•".substr($normalized, -4);
    }
}
