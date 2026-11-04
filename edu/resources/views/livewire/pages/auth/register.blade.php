<?php

use App\Models\ParentProfile;
use App\Models\StudentProfile;
use App\Models\TeacherProfile;
use App\Models\User;
use App\Rules\NotReservedEmail;
use App\Support\IndianMobile;
use Illuminate\Auth\Events\Registered;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.guest')] class extends Component
{
    public string $name = '';
    public string $email = '';
    public string $mobile = '';
    public string $password = '';
    public string $password_confirmation = '';
    public string $role = 'parent';

    /**
     * Public self-registration only covers parent/student/teacher — school
     * admin and government roles are provisioned by System Admin, not open
     * signup (spec section J).
     */
    public function register(): void
    {
        $validated = $this->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'lowercase', 'email', 'max:255', new NotReservedEmail, 'unique:'.User::class],
            'mobile' => ['nullable', 'string', 'max:20', function (string $attribute, mixed $value, Closure $fail): void {
                $normalized = IndianMobile::normalize($value);
                if ($normalized === null) {
                    $fail(__('Enter a 10-digit Indian mobile number, like 98765 43210.'));
                } elseif (User::where('mobile', $normalized)->exists()) {
                    $fail(__('This mobile number is already used by another account.'));
                }
            }],
            'password' => ['required', 'string', 'confirmed', Rules\Password::defaults()],
            'role' => ['required', 'in:parent,student,teacher'],
        ]);

        $user = User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            // Optional: lets the account sign in by a code sent to the phone.
            'mobile' => filled($validated['mobile'] ?? null) ? IndianMobile::normalize($validated['mobile']) : null,
            'password' => Hash::make($validated['password']),
        ]);

        $user->assignRole($validated['role']);

        match ($validated['role']) {
            'parent' => ParentProfile::create(['user_id' => $user->id]),
            'student' => StudentProfile::create(['user_id' => $user->id]),
            'teacher' => TeacherProfile::create(['user_id' => $user->id]),
        };

        event(new Registered($user));

        Auth::login($user);

        // Parent/student/teacher accounts aren't useful yet until they're
        // linked to a school — send them straight into that flow.
        $this->redirect(route('onboarding', absolute: false), navigate: true);
    }

    public function rendering($view): void
    {
        $view->title(__('Create an account'));
    }
}; ?>

<div>
    <h1>{{ __('Create your Education account') }}</h1>
    <p class="k-muted">{{ __('For parents, students and teachers. It takes a minute, and you can then link your account to your school.') }}</p>

    <form wire:submit="register" class="mt-4" novalidate>
        <div class="k-field">
            <x-input-label for="role" :value="__('I am registering as a')" />
            <select wire:model="role" id="role" class="k-select">
                <option value="parent">{{ __('Parent') }}</option>
                <option value="student">{{ __('Student') }}</option>
                <option value="teacher">{{ __('Teacher') }}</option>
            </select>
            <x-input-error :messages="$errors->get('role')" />
            <p class="k-hint">
                {{ __('Registering a school instead?') }}
                <a href="{{ route('schools.register') }}" wire:navigate>{{ __('Register your school here') }}</a>
                — {{ __('School Admin and government accounts are not created through this form.') }}
            </p>
        </div>

        <div class="k-field">
            <x-input-label for="name" :value="__('Name')" />
            <x-text-input wire:model="name" id="name" type="text" name="name" required autofocus autocomplete="name" />
            <x-input-error :messages="$errors->get('name')" />
        </div>

        <div class="k-field">
            <x-input-label for="email" :value="__('Email')" />
            <x-text-input wire:model="email" id="email" type="email" name="email" required autocomplete="username" />
            <x-input-error :messages="$errors->get('email')" />
        </div>

        <div class="k-field">
            <x-input-label for="mobile" :value="__('Mobile number (optional)')" />
            <x-text-input wire:model="mobile" id="mobile" type="tel" name="mobile" inputmode="tel" autocomplete="tel-national" placeholder="98765 43210" aria-describedby="mobile-hint" />
            <p id="mobile-hint" class="k-hint">{{ __('Optional. Sign-in codes go by email for now; a code by text message will come later.') }}</p>
            <x-input-error :messages="$errors->get('mobile')" />
        </div>

        <div class="k-field">
            <x-input-label for="password" :value="__('Password')" />
            <x-text-input wire:model="password" id="password" type="password" name="password" required autocomplete="new-password" />
            <x-input-error :messages="$errors->get('password')" />
        </div>

        <div class="k-field">
            <x-input-label for="password_confirmation" :value="__('Confirm Password')" />
            <x-text-input wire:model="password_confirmation" id="password_confirmation" type="password" name="password_confirmation" required autocomplete="new-password" />
            <x-input-error :messages="$errors->get('password_confirmation')" />
        </div>

        <button type="submit" class="k-btn k-btn--block" wire:loading.attr="aria-busy" wire:target="register">{{ __('Create account') }}</button>
    </form>

    <p class="mt-6 mb-0">
        {{ __('Already have an Education account?') }}
        <a href="{{ route('sign-in') }}" wire:navigate class="k-link font-semibold">{{ __('Sign in') }}</a>
    </p>
</div>
