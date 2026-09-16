<?php

use App\Models\Invitation;
use App\Models\ParentSchoolRelationship;
use App\Models\StudentSchoolRelationship;
use App\Models\TeacherSchoolRelationship;
use App\Models\User;
use App\Notifications\InvitationAccepted;
use Illuminate\Auth\Events\Registered;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.guest')] class extends Component
{
    public Invitation $invitation;
    public string $name = '';
    public string $password = '';
    public string $password_confirmation = '';
    public bool $accepted = false;
    public bool $invalid = false;

    public function mount(string $token): void
    {
        $invitation = Invitation::where('token', $token)->first();

        if (! $invitation || $invitation->status !== 'pending') {
            $this->invalid = true;

            return;
        }

        $this->invitation = $invitation->load('school');
    }

    /**
     * A school-initiated invite is pre-trusted — the relationship is
     * created 'verified' immediately on acceptance, no separate School
     * Admin approval step (spec intent: the invite itself IS the vetting).
     */
    public function accept(): void
    {
        if (Auth::check()) {
            abort_unless(Auth::user()->email === $this->invitation->email, 403, 'This invitation was sent to a different email address. Log out and use that account, or ask the school to resend it to yours.');
            $user = Auth::user();
        } else {
            $validated = $this->validate([
                'name' => ['required', 'string', 'max:255'],
                'password' => ['required', 'confirmed', Rules\Password::defaults()],
            ]);

            $user = User::create([
                'name' => $validated['name'],
                'email' => $this->invitation->email,
                'password' => Hash::make($validated['password']),
            ]);
            event(new Registered($user));
            Auth::login($user);
        }

        if (! $user->hasRole($this->invitation->role)) {
            $user->assignRole($this->invitation->role);
        }

        match ($this->invitation->role) {
            'parent' => ParentSchoolRelationship::updateOrCreate(
                ['user_id' => $user->id, 'school_id' => $this->invitation->school_id],
                ['status' => 'verified', 'verified_at' => now()]
            ),
            'student' => StudentSchoolRelationship::updateOrCreate(
                ['user_id' => $user->id, 'school_id' => $this->invitation->school_id],
                ['status' => 'verified', 'verified_at' => now()]
            ),
            'teacher' => TeacherSchoolRelationship::updateOrCreate(
                ['user_id' => $user->id, 'school_id' => $this->invitation->school_id],
                ['status' => 'verified', 'verified_at' => now()]
            ),
        };

        $this->invitation->update([
            'status' => 'accepted',
            'accepted_by_user_id' => $user->id,
            'accepted_at' => now(),
        ]);

        $this->invitation->invitedBy?->notify(new InvitationAccepted($this->invitation, $user));

        $this->accepted = true;
    }
}; ?>

<div class="min-h-screen flex flex-col items-center pt-12 bg-gray-100">
    <div class="w-full sm:max-w-md px-6 py-8 bg-white shadow-md rounded-lg">
        @if ($invalid)
            <h2 class="font-semibold text-lg text-gray-900">Invitation not found</h2>
            <p class="text-sm text-gray-500 mt-2">This invitation link is invalid, has already been used, or was revoked.</p>
            <a href="{{ route('home') }}" wire:navigate class="inline-block mt-6 text-indigo-600 text-sm hover:underline">Go to homepage</a>
        @elseif ($accepted)
            <h2 class="font-semibold text-lg text-green-700">You're in!</h2>
            <p class="text-sm text-gray-600 mt-2">
                You've joined {{ $invitation->school->name }} as a verified {{ $invitation->role }} — no further
                approval needed.
            </p>
            <a href="{{ route('dashboard') }}" wire:navigate class="inline-block mt-6 px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">Go to Dashboard</a>
        @else
            <h2 class="font-semibold text-lg text-gray-900">You're invited to {{ $invitation->school->name }}</h2>
            <p class="text-sm text-gray-500 mt-2">
                As a <strong>{{ ucfirst($invitation->role) }}</strong>{{ $invitation->student_name ? ' (for '.$invitation->student_name.')' : '' }}.
                Accepting links your account as a <strong>verified</strong> {{ $invitation->role }} — the school
                already vetted this invite, so there's no additional approval step.
            </p>

            @auth
                @if (Auth::user()->email !== $invitation->email)
                    <p class="text-sm text-red-600 mt-4">
                        This invitation was sent to {{ $invitation->email }}, but you're logged in as
                        {{ Auth::user()->email }}. Log out and use the invited account to accept.
                    </p>
                @else
                    <x-primary-button class="mt-6" wire:click="accept">Accept Invitation</x-primary-button>
                @endif
            @else
                <form wire:submit="accept" class="mt-6 space-y-4">
                    <div>
                        <x-input-label value="Email" />
                        <x-text-input :value="$invitation->email" class="mt-1 w-full bg-gray-100" disabled />
                    </div>
                    <div>
                        <x-input-label for="name" value="Your name" />
                        <x-text-input wire:model="name" id="name" class="mt-1 w-full" />
                        <x-input-error :messages="$errors->get('name')" class="mt-2" />
                    </div>
                    <div>
                        <x-input-label for="password" value="Choose a password" />
                        <x-text-input wire:model="password" id="password" type="password" class="mt-1 w-full" />
                        <x-input-error :messages="$errors->get('password')" class="mt-2" />
                    </div>
                    <div>
                        <x-input-label for="password_confirmation" value="Confirm password" />
                        <x-text-input wire:model="password_confirmation" id="password_confirmation" type="password" class="mt-1 w-full" />
                    </div>
                    <x-primary-button>Create Account & Accept</x-primary-button>
                </form>

                <p class="text-xs text-gray-400 mt-4">
                    Already have an account? <a href="{{ route('login') }}" wire:navigate class="underline">Log in</a> then revisit this link.
                </p>
            @endauth
        @endif
    </div>
</div>
