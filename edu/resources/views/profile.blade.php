<x-app-layout>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">
            {{ __('Profile') }}
        </h2>
    </x-slot>

    <div class="py-12">
        <div class="max-w-7xl mx-auto sm:px-6 lg:px-8 space-y-6">
            <div class="p-4 sm:p-8 bg-white shadow sm:rounded-lg">
                <div class="max-w-xl">
                    <livewire:profile.update-profile-information-form />
                </div>
            </div>

            <div class="p-4 sm:p-8 bg-white shadow sm:rounded-lg">
                <div class="max-w-xl">
                    <livewire:profile.update-password-form />
                </div>
            </div>

            @role('school_admin|district_officer|state_officer|national_admin|system_admin')
                <div class="p-4 sm:p-8 bg-white shadow sm:rounded-lg">
                    <div class="max-w-xl flex items-center justify-between">
                        <div>
                            <h2 class="font-medium text-lg text-gray-900">Two-Factor Authentication</h2>
                            <p class="text-sm text-gray-500 mt-1">Add a second login step using an authenticator app.</p>
                        </div>
                        <a href="{{ route('settings.two-factor') }}" wire:navigate class="text-indigo-600 text-sm hover:underline whitespace-nowrap">Manage &rarr;</a>
                    </div>
                </div>
            @endrole

            <div class="p-4 sm:p-8 bg-white shadow sm:rounded-lg">
                <div class="max-w-xl">
                    <livewire:profile.delete-user-form />
                </div>
            </div>
        </div>
    </div>
</x-app-layout>
