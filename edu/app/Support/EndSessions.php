<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Ends every session an account has: the stored ones (the database session
 * store every tier uses) and its remember-me cookies. Used when the account
 * changes hands or its password is reset, so whoever was signed in before
 * stays out.
 */
final class EndSessions
{
    public static function forUser(User $user): void
    {
        $user->forceFill(['remember_token' => Str::random(60)])->save();

        $table = (string) config('session.table', 'sessions');
        if (Schema::hasTable($table)) {
            DB::table($table)->where('user_id', $user->getKey())->delete();
        }
    }
}
