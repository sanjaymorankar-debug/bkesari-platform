<?php

namespace App\Rules;

use App\Support\BuiltinAdmins;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Refuses an address on the built-in administrators' domain (anything ending
 * in "@builtin.bkesari.com"), however it is typed (D-036): those addresses
 * belong to smorankar and sonalimorankar, who sign in only with their username.
 */
class NotReservedEmail implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (is_string($value) && BuiltinAdmins::isReservedEmail($value)) {
            $fail(__('This email address is reserved.'));
        }
    }
}
