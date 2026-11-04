<?php

use App\Livewire\Actions\Logout;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Gate;
use Livewire\Volt\Component;

/**
 * Education's own navigation, under the bkesari shell: a side nav on wide
 * screens and a bottom bar of at most four items on phones. The shell above
 * it carries the bkesari logo, the project switcher, language, theme and the
 * account menu; this carries the places inside Education, and differs by role.
 */
new class extends Component
{
    public int $unreadNotifications = 0;

    public function mount(): void
    {
        $this->unreadNotifications = Auth::check() ? Auth::user()->unreadNotifications()->count() : 0;
    }

    /**
     * Log the current user out of the application.
     */
    public function logout(Logout $logout): void
    {
        $logout();

        $this->redirect(route('home'), navigate: true);
    }

    public function with(): array
    {
        $user = Auth::user();
        $item = fn (string $key, string $label, string $href, bool $active, string $icon, int $badge = 0) => compact('key', 'label', 'href', 'active', 'icon', 'badge');

        $home = $user
            ? $item('home', __('Home'), route('dashboard'), request()->routeIs('dashboard*'), 'home')
            : $item('home', __('Home'), route('home'), request()->routeIs('home'), 'home');
        $schools = $item('schools', __('Schools'), route('schools.index'), request()->routeIs('schools.index', 'schools.show', 'improvement.show'), 'school');
        $compare = $item('compare', __('How India compares'), route('benchmarks.index'), request()->routeIs('benchmarks.index'), 'globe');
        $registerSchool = $item('register-school', __('Register a school'), route('schools.register'), request()->routeIs('schools.register'), 'plus');

        if (! $user) {
            // For a visitor, home is the school search itself.
            $signIn = $item('sign-in', __('Sign in'), route('login'), request()->routeIs('login', 'sign-in'), 'user');
            $signUp = $item('sign-up', __('Create an account'), route('register'), request()->routeIs('register', 'sign-up'), 'plus');
            $home['active'] = request()->routeIs('home', 'schools.index', 'schools.show', 'improvement.show');

            return [
                'side' => [$home, $compare, $registerSchool, $signIn, $signUp],
                'bottom' => [$home, $compare, $registerSchool, $signIn],
            ];
        }

        $alerts = $item('notifications', __('Notifications'), route('notifications.index'), request()->routeIs('notifications.*'), 'bell', $this->unreadNotifications);
        $profile = $item('profile', __('Profile'), route('profile'), request()->routeIs('profile', 'settings.*'), 'user');

        $extra = [];
        if ($user->hasRole('student')) {
            $extra[] = $item('growth', __('My growth'), route('growth.show', $user->id), request()->routeIs('growth.*', 'career.*', 'life-skills.*'), 'sprout');
        }
        if ($user->hasAnyRole(['parent', 'student'])) {
            $extra[] = $item('report', __('Report a problem'), route('complaints.create'), request()->routeIs('complaints.*', 'retaliation.*', 'appeals.*'), 'flag');
        }
        if ($user->hasRole('parent')) {
            $extra[] = $item('consent', __('Consent'), route('consent.manage'), request()->routeIs('consent.*'), 'shield');
        }
        if ($user->hasAnyRole(['district_officer', 'state_officer', 'national_admin', 'system_admin'])) {
            $extra[] = $item('verification', __('Verification'), route('verification.queue'), request()->routeIs('verification.*'), 'check');
        }
        if (Gate::allows('handle-safeguarding-cases')) {
            $extra[] = $item('safeguarding', __('Safeguarding'), route('safeguarding.queue'), request()->routeIs('safeguarding.queue', 'safeguarding.show'), 'shield');
        }
        if ($user->hasRole('counsellor')) {
            $extra[] = $item('counselling', __('Counselling'), route('counselling.portal'), request()->routeIs('counselling.*'), 'chat');
        }
        if ($user->hasAnyRole(['data_protection_officer', 'system_admin'])) {
            $extra[] = $item('privacy', __('Data requests'), route('privacy.queue'), request()->routeIs('privacy.queue'), 'lock');
        }

        // Phones get four: Home, the one place this role goes most, alerts
        // and the profile (which also holds sign-out).
        $second = match (true) {
            $user->hasRole('student') => $extra[0],
            $user->hasAnyRole(['district_officer', 'state_officer', 'national_admin']) => collect($extra)->firstWhere('key', 'verification'),
            default => $schools,
        };

        return [
            'side' => array_merge([$home, $schools], $extra, [$alerts, $profile, $compare, $registerSchool]),
            'bottom' => [$home, $second, $alerts, $profile],
        ];
    }
}; ?>

@php
    $icons = [
        'home' => '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
        'school' => '<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6"/>',
        'globe' => '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
        'plus' => '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
        'user' => '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
        'bell' => '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
        'sprout' => '<path d="M12 21V11"/><path d="M12 11C12 7 9 5 5 5c0 4 3 6 7 6zM12 13c0-4 3-6 7-6 0 4-3 6-7 6z"/>',
        'flag' => '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
        'shield' => '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
        'check' => '<path d="M4 12.5 9 17 20 6"/>',
        'chat' => '<path d="M4 5h16v11H8l-4 4z"/>',
        'lock' => '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
        'out' => '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
    ];
    $svg = fn ($name) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'.$icons[$name].'</svg>';
@endphp

<div class="contents">
    <nav class="k-sidenav" aria-label="{{ __('Education') }}">
        <ul>
            @foreach ($side as $link)
                <li>
                    <a href="{{ $link['href'] }}" wire:navigate class="edu-nav-link" @if ($link['active']) aria-current="page" @endif>
                        {!! $svg($link['icon']) !!}
                        <span class="flex-1">{{ $link['label'] }}</span>
                        @if ($link['badge'] > 0)
                            <span class="k-badge" aria-label="{{ trans_choice(':count unread|:count unread', $link['badge']) }}">{{ min($link['badge'], 99) }}</span>
                        @endif
                    </a>
                </li>
            @endforeach
            @auth
                <li>
                    <button type="button" wire:click="logout" class="edu-sidenav-button">
                        {!! $svg('out') !!}
                        <span>{{ __('Sign out') }}</span>
                    </button>
                </li>
            @endauth
        </ul>
    </nav>

    <nav class="k-bottomnav" aria-label="{{ __('Education, quick links') }}">
        @foreach ($bottom as $link)
            <a href="{{ $link['href'] }}" wire:navigate class="edu-nav-link" @if ($link['active']) aria-current="page" @endif>
                <span class="relative">
                    {!! $svg($link['icon']) !!}
                    @if ($link['badge'] > 0)
                        <span class="edu-dot" aria-hidden="true"></span>
                    @endif
                </span>
                <span>{{ $link['key'] === 'notifications' ? __('Alerts') : $link['label'] }}</span>
                @if ($link['badge'] > 0)
                    <span class="k-sr-only">{{ trans_choice(':count unread|:count unread', $link['badge']) }}</span>
                @endif
            </a>
        @endforeach
    </nav>
</div>
