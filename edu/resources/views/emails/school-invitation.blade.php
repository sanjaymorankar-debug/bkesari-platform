<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; color: #1f2937; max-width: 480px; margin: 0 auto; padding: 24px;">
    <h2 style="margin-bottom: 4px;">{{ config('app.name') }}</h2>
    <p>You've been invited to join <strong>{{ $invitation->school->name }}</strong> as a
        <strong>{{ ucfirst($invitation->role) }}</strong>{{ $invitation->student_name ? ' (for '.$invitation->student_name.')' : '' }}.</p>
    <p>The school has already vetted this invite, so your account is verified immediately on acceptance.</p>
    <p style="margin: 24px 0;">
        <a href="{{ $link }}" style="background: #4f46e5; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">
            Accept Invitation
        </a>
    </p>
    <p style="color: #9ca3af; font-size: 12px;">Or copy this link: {{ $link }}</p>
</body>
</html>
