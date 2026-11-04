<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<body style="font-family: sans-serif; color: #1f2937; max-width: 480px; margin: 0 auto; padding: 24px;">
    <h2 style="margin-bottom: 4px;">{{ __('Education') }}</h2>
    <p>{{ __('Use this code to sign in to Education:') }}</p>
    <p style="background: #f3f4f6; padding: 12px; border-radius: 6px; font-size: 28px; letter-spacing: 6px; text-align: center;">
        <strong style="font-family: monospace;">{{ $code }}</strong>
    </p>
    <p>{{ __('It works once, for 10 minutes. Do not share it with anyone.') }}</p>
    <p><strong>{{ __('This is a separate account for Education.') }}</strong></p>
    <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
        {{ __('If you didn\'t ask for this, ignore this email.') }}
    </p>
</body>
</html>
