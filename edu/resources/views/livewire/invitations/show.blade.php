<?php

use App\Models\AuditLog;
use App\Models\Invitation;
use App\Models\ParentSchoolRelationship;
use App\Models\StudentSchoolRelationship;
use App\Models\TeacherSchoolRelationship;
use App\Models\User;
use App\Notifications\InvitationAccepted;
use App\Services\EmailSignIn;
use App\Support\BuiltinAdmins;
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

        // No invitation makes or joins an account on the built-in
        // administrators' reserved domain (D-036).
        if (! $invitation || $invitation->status !== 'pending' || BuiltinAdmins::isReservedEmail($invitation->email)) {
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
        // Still pending, and still there. `mount()` runs once; the page can
        // have been open since before the school revoked the invitation, or
        // since an earlier click already used it, and Livewire re-hydrates
        // the model without re-running `mount()`. Without this the school's
        // revocation does not hold — the invitee's open page still mints
        // `verified` standing — and a second click writes the acceptance a
        // second time. Checked before the account is made, so a guest on a
        // revoked invitation gets no account either.
        abort_unless(
            isset($this->invitation) && $this->invitation->status === 'pending',
            403,
            'This invitation is no longer valid — it has already been used or the school revoked it. Ask the school to send a new one.'
        );

        if (Auth::check()) {
            // citext: the address the school typed and the address on the
            // account are the same identity when they differ only in case
            // (PostgreSQL compares them that way, and `EmailSignIn` signs
            // people in that way), so comparing the raw strings would strand
            // a genuine invitee whose account spells it differently.
            abort_unless(
                EmailSignIn::normalize((string) Auth::user()->email) === EmailSignIn::normalize((string) $this->invitation->email),
                403,
                'This invitation was sent to a different email address. Log out and use that account, or ask the school to resend it to yours.'
            );
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

        // The invite is the vetting, so acceptance mints a `verified`
        // relationship with no approval step — which means accepting your
        // own invite is a self-grant, and the one the approval queue exists
        // to prevent. Refused here rather than only at `sendInvite`, because
        // this is where the standing is created: an invite made any other
        // way (an older one, a seeder, a future API) cannot slip past.
        abort_if(
            $this->invitation->invited_by_user_id === $user->id,
            403,
            'You cannot accept an invitation you sent yourself. Another member of staff has to decide your own link to this school.'
        );

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

        // The invite itself is the vetting for these relationships (they are
        // created already verified), so the acceptance is the decision point
        // worth recording.
        AuditLog::record('invitation.accepted', $user->id, $this->invitation, [
            'school_id' => $this->invitation->school_id,
            'role' => $this->invitation->role,
            'invited_by_user_id' => $this->invitation->invited_by_user_id,
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
