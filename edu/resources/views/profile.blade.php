<x-app-layout>
    <x-slot name="title">{{ __('Profile') }}</x-slot>

    <x-slot name="header">
        <p class="k-eyebrow"><x-k-icon name="user" /> {{ __('Profile') }}</p>
        <h1>{{ __('Your Education account') }}</h1>
        <p class="edu-page-head__lead">{{ __('Your name and how you sign in. This account is for Education only.') }}</p>
    </x-slot>

    @php($me = auth()->user())
    <div class="edu-dash edu-narrow">
        <section class="k-card edu-account" aria-label="{{ __('Signed in as') }}">
            <span class="k-avatar k-avatar--lg" aria-hidden="true">{{ mb_strtoupper(mb_substr($me->name, 0, 1)) }}</span>
            <div class="min-w-0">
                <p class="edu-account__name">{{ $me->name }}</p>
                <p class="edu-rows__sub break-all">{{ $me->email }}</p>
                @if ($me->getRoleNames()->isNotEmpty())
                    <ul class="edu-chips" role="list" aria-label="{{ __('Your roles') }}">
                        @foreach ($me->getRoleNames() as $role)
                            <li><span class="k-chip k-chip--accent k-chip--plain"><x-role-label :role="$role" /></span></li>
                        @endforeach
                    </ul>
                @endif
            </div>
        </section>

        <div class="k-card">
            <livewire:profile.update-profile-information-form />
        </div>

        <div class="k-card">
            <livewire:profile.update-password-form />
        </div>

        @role('school_admin|district_officer|state_officer|national_admin|system_admin')
            <section class="k-card edu-setting" aria-labelledby="two-factor-title">
                <span class="k-picon k-picon--sm"><x-k-icon name="lock" /></span>
                <div class="min-w-0">
                    <h2 id="two-factor-title" class="edu-panel__title">{{ __('Two-Factor Authentication') }}</h2>
                    <p>{{ __('Add a second login step using an authenticator app.') }}</p>
                </div>
                <a href="{{ route('settings.two-factor') }}" wire:navigate class="k-btn k-btn--secondary">{{ __('Manage') }}</a>
            </section>
        @endrole

        {{-- Signing out is also in the bkesari shell's account menu; it is
             here too because on a phone the profile is where people look. --}}
        <section class="k-card edu-setting" aria-labelledby="sign-out-title">
            <span class="k-picon k-picon--sm"><x-k-icon name="sign-in" class="edu-flip" /></span>
            <div class="min-w-0">
                <h2 id="sign-out-title" class="edu-panel__title">{{ __('Sign out') }}</h2>
                <p>{{ __('Signs you out of Education on this device. Other bkesari projects are not affected.') }}</p>
            </div>
            <form method="POST" action="{{ route('logout') }}">
                @csrf
                <button type="submit" class="k-btn k-btn--secondary">{{ __('Sign out') }}</button>
            </form>
        </section>

        <div class="k-card edu-danger-zone">
            <livewire:profile.delete-user-form />
        </div>
    </div>
</x-app-layout>
