<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; color: #1f2937; max-width: 480px; margin: 0 auto; padding: 24px;">
    <h2 style="margin-bottom: 4px;">{{ config('app.name') }}</h2>
    <p>Hi {{ $recipientName }},</p>
    <p>An account has been created for you at <strong>{{ $schoolName }}</strong> on {{ config('app.name') }}.</p>
    <p style="background: #f3f4f6; padding: 12px; border-radius: 6px;">
        Temporary password: <strong style="font-family: monospace;">{{ $temporaryPassword }}</strong>
    </p>
    <p>Log in and change this password as soon as possible.</p>
    <p><a href="{{ route('login') }}">{{ route('login') }}</a></p>
    <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        If you weren't expecting this, you can ignore this email.
    </p>
</body>
</html>
