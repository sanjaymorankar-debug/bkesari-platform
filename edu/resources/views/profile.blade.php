<x-app-layout>
    <x-slot name="header">
        <h2>{{ __('Profile') }}</h2>
    </x-slot>

    <div class="max-w-3xl space-y-6">
        <div class="k-card">
            <livewire:profile.update-profile-information-form />
        </div>

        <div class="k-card">
            <livewire:profile.update-password-form />
        </div>

        @role('school_admin|district_officer|state_officer|national_admin|system_admin')
            <div class="k-card">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 class="text-lg font-semibold text-gray-900">{{ __('Two-Factor Authentication') }}</h2>
                        <p class="text-sm text-gray-600 mt-1">{{ __('Add a second login step using an authenticator app.') }}</p>
                    </div>
                    <a href="{{ route('settings.two-factor') }}" wire:navigate class="k-btn k-btn--secondary">{{ __('Manage') }}</a>
                </div>
            </div>
        @endrole

        {{-- Signing out is also in the bkesari shell's account menu; it is
             here too because on a phone the profile is where people look. --}}
        <div class="k-card">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 class="text-lg font-semibold text-gray-900">{{ __('Sign out') }}</h2>
                    <p class="text-sm text-gray-600 mt-1">{{ __('Signs you out of Education on this device. Other bkesari projects are not affected.') }}</p>
                </div>
                <form method="POST" action="{{ route('logout') }}">
                    @csrf
                    <button type="submit" class="k-btn k-btn--secondary">{{ __('Sign out') }}</button>
                </form>
            </div>
        </div>

        <div class="k-card">
            <div class="max-w-xl">
                <livewire:profile.delete-user-form />
            </div>
        </div>
    </div>
</x-app-layout>
