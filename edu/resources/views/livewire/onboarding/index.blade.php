<?php

use App\Livewire\Concerns\SendsMailSafely;
use App\Mail\StaffCredentialsMail;
use App\Models\ParentSchoolRelationship;
use App\Models\School;
use App\Models\StudentProfile;
use App\Models\StudentSchoolRelationship;
use App\Models\TeacherSchoolRelationship;
use App\Models\User;
use App\Rules\NotReservedEmail;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    use SendsMailSafely;

    public string $schoolId = '';
    public string $search = '';

    // Parent
    public string $phone = '';
    public bool $addChild = false;
    public string $childMode = 'new'; // 'new' or 'existing'
    public string $childName = '';
    public string $childEmail = '';
    public string $childDateOfBirth = '';
    public string $childGender = '';
    public string $childClassGrade = '';

    // Student (self-registering)
    public string $dateOfBirth = '';
    public string $gender = '';
    public string $classGrade = '';

    public bool $linked = false;
    public ?string $childTempPassword = null;

    public function mount(): void
    {
        $this->schoolId = (string) request()->query('school', '');
    }

    /**
     * Self-declared relationship — starts pending, the School Admin has to
     * approve it before this user can submit a complaint or rating for that
     * school (spec section H: verified-but-anonymous participation).
     */
    public function link(): void
    {
        $user = Auth::user();
        $role = $user->getRoleNames()->first();

        $this->validate(['schoolId' => ['required', 'exists:schools,id']]);

        $school = School::findOrFail($this->schoolId);

        if ($role === 'parent') {
            $this->validate(['phone' => ['required', 'string', 'max:20']]);

            $existing = ParentSchoolRelationship::where('user_id', $user->id)->where('school_id', $school->id)->first();
            abort_if($existing, 422, 'You have already requested to link this school.');

            $user->parentProfile()->updateOrCreate([], ['phone' => $this->phone]);

            $studentUserId = $this->addChild ? $this->resolveChild($school) : null;

            ParentSchoolRelationship::create([
                'user_id' => $user->id,
                'school_id' => $school->id,
                'student_user_id' => $studentUserId,
                'status' => 'pending',
            ]);
        } elseif ($role === 'student') {
            $this->validate([
                'dateOfBirth' => ['required', 'date', 'before:today'],
                'gender' => ['required', 'in:male,female,other'],
                'classGrade' => ['required', 'string', 'max:20'],
            ]);

            $existing = StudentSchoolRelationship::where('user_id', $user->id)->where('school_id', $school->id)->first();
            abort_if($existing, 422, 'You have already requested to link this school.');

            $user->studentProfile()->updateOrCreate([], [
                'date_of_birth' => $this->dateOfBirth,
                'gender' => $this->gender,
            ]);
            StudentSchoolRelationship::create([
                'user_id' => $user->id,
                'school_id' => $school->id,
                'class_grade' => $this->classGrade,
                'status' => 'pending',
            ]);
        } elseif ($role === 'teacher') {
            $existing = TeacherSchoolRelationship::where('user_id', $user->id)->where('school_id', $school->id)->first();
            abort_if($existing, 422, 'You have already requested to link this school.');

            TeacherSchoolRelationship::create([
                'user_id' => $user->id,
                'school_id' => $school->id,
                'status' => 'pending',
            ]);
        }

        $this->linked = true;
    }

    /**
     * Either links to the child's existing student account, or creates one
     * (with a one-time temp password, same pattern as school-staff invites
     * — this environment has no real mail sending). Either way the child's
     * own relationship to the school is a normal pending request that still
     * needs School Admin approval — a parent registering doesn't bypass
     * that trust boundary for their child.
     */
    private function resolveChild(School $school): ?int
    {
        if ($this->childMode === 'existing') {
            $this->validate(['childEmail' => ['required', 'email', new NotReservedEmail, 'exists:users,email']]);

            $child = User::where('email', $this->childEmail)->firstOrFail();
            abort_unless($child->hasRole('student'), 422, 'That account is not registered as a student.');

            if (! StudentSchoolRelationship::where('user_id', $child->id)->where('school_id', $school->id)->exists()) {
                StudentSchoolRelationship::create([
                    'user_id' => $child->id,
                    'school_id' => $school->id,
                    'status' => 'pending',
                ]);
            }

            return $child->id;
        }

        $this->validate([
            'childName' => ['required', 'string', 'max:255'],
            'childEmail' => ['required', 'email', 'max:255', new NotReservedEmail, 'unique:users,email'],
            'childDateOfBirth' => ['required', 'date', 'before:today'],
            'childGender' => ['required', 'in:male,female,other'],
            'childClassGrade' => ['required', 'string', 'max:20'],
        ]);

        $tempPassword = Str::password(12);

        $child = User::create([
            'name' => $this->childName,
            'email' => $this->childEmail,
            'password' => Hash::make($tempPassword),
        ]);
        $child->assignRole('student');

        StudentProfile::create([
            'user_id' => $child->id,
            'date_of_birth' => $this->childDateOfBirth,
            'gender' => $this->childGender,
        ]);

        StudentSchoolRelationship::create([
            'user_id' => $child->id,
            'school_id' => $school->id,
            'class_grade' => $this->childClassGrade,
            'status' => 'pending',
        ]);

        $this->childTempPassword = $tempPassword;
        $this->tryMail($child->email, fn () => new StaffCredentialsMail($child->name, $school->name, $tempPassword));

        return $child->id;
    }

    public function with(): array
    {
        $query = School::query()->orderBy('name');

        if ($this->search !== '') {
            // Case-insensitive on every driver (ILIKE on PostgreSQL).
            $query->whereLike('name', "%{$this->search}%");
        }

        return [
            'schools' => $query->limit(50)->get(['id', 'name', 'city']),
            'role' => Auth::user()->getRoleNames()->first(),
        ];
    }

    public function rendering($view): void
    {
        $view->title(__('Link your school'));
    }
}; ?>

<div>
    <x-slot name="header">
        <p class="k-eyebrow"><x-k-icon name="school" /> {{ __('Getting started') }}</p>
        <h1>{{ __('Link your school') }}</h1>
        <p class="edu-page-head__lead">{{ __('Tell us which school you belong to. Your school approves the link, then you can take part.') }}</p>
    </x-slot>

    <div class="edu-narrow">
        <ol class="k-stepper" aria-label="{{ __('Your progress') }}">
            <li data-done>{{ __('Account created') }}<span class="k-sr-only">: {{ __('done') }}</span></li>
            <li @if ($linked) data-done @else aria-current="step" @endif>{{ __('School link requested') }}@if ($linked)<span class="k-sr-only">: {{ __('done') }}</span>@endif</li>
            <li @if ($linked) aria-current="step" @endif>{{ __('School approved your link') }}<span class="k-sr-only">: {{ __('not yet') }}</span></li>
        </ol>

        <div class="k-card">
            @if ($linked)
                <div class="edu-success" role="status">
                    <span class="k-picon k-picon--lg"><x-k-icon name="check" /></span>
                    <h2>{{ __('Request sent — pending verification') }}</h2>
                    <p>{{ __('The school’s admin needs to approve this link before you can submit complaints or ratings for it. You can still browse schools and track any existing complaints in the meantime.') }}</p>
                </div>

                @if ($childTempPassword)
                    <div class="k-banner k-banner--brand mt-4">
                        <x-k-icon name="info" />
                        <div class="min-w-0">
                            <p><strong>{{ __('Your child’s account') }}</strong></p>
                            <p class="text-sm">{{ __('These details are shown only here, once. Share them with your child yourself; they should change the password after first signing in.') }}</p>
                            <dl class="edu-facts edu-facts--stack">
                                <div><dt>{{ __('Email') }}</dt><dd class="break-all">{{ $childEmail }}</dd></div>
                                <div><dt>{{ __('Temporary password') }}</dt><dd class="font-mono">{{ $childTempPassword }}</dd></div>
                            </dl>
                        </div>
                    </div>
                @endif

                <a href="{{ route('dashboard') }}" wire:navigate class="k-btn mt-6">{{ __('Go to your dashboard') }} <x-k-icon name="arrow-right" /></a>
            @else
                <p class="k-muted">
                    {{ match ($role) {
                        'student' => __('The school’s admin approves the link before you can submit anything for it. The school never sees your name, only that a verified student spoke up.'),
                        'teacher' => __('The school’s admin approves the link before you can submit anything for it. The school never sees your name, only that a verified teacher spoke up.'),
                        default => __('The school’s admin approves the link before you can submit anything for it. The school never sees your name, only that a verified parent spoke up.'),
                    } }}
                </p>

                <form wire:submit="link" class="mt-4" novalidate>
                    <div class="k-field">
                        <x-input-label for="search" :value="__('Search for your school')" />
                        <div class="k-search">
                            <x-text-input wire:model.live.debounce.300ms="search" id="search" type="search" autocomplete="off" :placeholder="__('Type a school name...')" aria-describedby="search-hint" />
                        </div>
                        <p id="search-hint" class="k-hint" role="status">
                            <span wire:loading.remove wire:target="search">{{ trans_choice(':count school matches|:count schools match', $schools->count()) }}</span>
                            <span wire:loading wire:target="search">{{ __('Searching…') }}</span>
                        </p>
                    </div>

                    <div class="k-field">
                        <x-input-label for="schoolId" :value="__('School')" />
                        <select wire:model="schoolId" id="schoolId" class="k-select" @error('schoolId') aria-invalid="true" @enderror>
                            <option value="">{{ __('Choose your school') }}</option>
                            @foreach ($schools as $school)
                                <option value="{{ $school->id }}">{{ $school->name }} ({{ $school->city }})</option>
                            @endforeach
                        </select>
                        @if ($schools->isEmpty())
                            <p class="k-hint">{{ __('No school matches that name. Check the spelling, or register the school if it is missing.') }}
                                <a href="{{ route('schools.register') }}" wire:navigate>{{ __('Register a school') }}</a></p>
                        @endif
                        <x-input-error :messages="$errors->get('schoolId')" />
                    </div>

                    @if ($role === 'parent')
                        <div class="k-field">
                            <x-input-label for="phone" :value="__('Phone number')" />
                            <x-text-input wire:model="phone" id="phone" type="tel" inputmode="tel" autocomplete="tel-national" />
                            <x-input-error :messages="$errors->get('phone')" />
                        </div>

                        <fieldset class="edu-fieldset">
                            <legend class="k-sr-only">{{ __('Your child') }}</legend>
                            <label class="k-check">
                                <input type="checkbox" wire:model.live="addChild">
                                <span>{{ __('Also register my child at this school') }}</span>
                            </label>

                            @if ($addChild)
                                <fieldset class="k-field">
                                    <legend class="k-label">{{ __('Does your child have an account?') }}</legend>
                                    <label class="k-check"><input type="radio" wire:model.live="childMode" value="new"> <span>{{ __('Create a new account for my child') }}</span></label>
                                    <label class="k-check"><input type="radio" wire:model.live="childMode" value="existing"> <span>{{ __('My child already has an account') }}</span></label>
                                </fieldset>

                                @if ($childMode === 'existing')
                                    <div class="k-field">
                                        <x-input-label for="childEmail" :value="__('Child’s email')" />
                                        <x-text-input wire:model="childEmail" id="childEmail" type="email" />
                                        <x-input-error :messages="$errors->get('childEmail')" />
                                    </div>
                                @else
                                    <div class="k-field">
                                        <x-input-label for="childName" :value="__('Child’s name')" />
                                        <x-text-input wire:model="childName" id="childName" autocomplete="off" />
                                        <x-input-error :messages="$errors->get('childName')" />
                                    </div>
                                    <div class="k-field">
                                        <x-input-label for="childEmail" :value="__('Child’s email')" />
                                        <x-text-input wire:model="childEmail" id="childEmail" type="email" autocomplete="off" />
                                        <x-input-error :messages="$errors->get('childEmail')" />
                                    </div>
                                    <div class="grid gap-x-4 sm:grid-cols-2">
                                        <div class="k-field">
                                            <x-input-label for="childDateOfBirth" :value="__('Date of birth')" />
                                            <x-text-input wire:model="childDateOfBirth" id="childDateOfBirth" type="date" />
                                            <x-input-error :messages="$errors->get('childDateOfBirth')" />
                                        </div>
                                        <div class="k-field">
                                            <x-input-label for="childClassGrade" :value="__('Class / Grade')" />
                                            <x-text-input wire:model="childClassGrade" id="childClassGrade" :placeholder="__('e.g. 8')" />
                                            <x-input-error :messages="$errors->get('childClassGrade')" />
                                        </div>
                                    </div>
                                    <div class="k-field">
                                        <x-input-label for="childGender" :value="__('Gender')" />
                                        <select wire:model="childGender" id="childGender" class="k-select">
                                            <option value="">{{ __('Select') }}</option>
                                            <option value="male">{{ __('Male') }}</option>
                                            <option value="female">{{ __('Female') }}</option>
                                            <option value="other">{{ __('Other') }}</option>
                                        </select>
                                        <x-input-error :messages="$errors->get('childGender')" />
                                    </div>
                                @endif
                            @endif
                        </fieldset>
                    @elseif ($role === 'student')
                        <div class="grid gap-x-4 sm:grid-cols-2">
                            <div class="k-field">
                                <x-input-label for="dateOfBirth" :value="__('Date of birth')" />
                                <x-text-input wire:model="dateOfBirth" id="dateOfBirth" type="date" />
                                <x-input-error :messages="$errors->get('dateOfBirth')" />
                            </div>
                            <div class="k-field">
                                <x-input-label for="classGrade" :value="__('Class / Grade')" />
                                <x-text-input wire:model="classGrade" id="classGrade" :placeholder="__('e.g. 8')" />
                                <x-input-error :messages="$errors->get('classGrade')" />
                            </div>
                        </div>
                        <div class="k-field">
                            <x-input-label for="gender" :value="__('Gender')" />
                            <select wire:model="gender" id="gender" class="k-select">
                                <option value="">{{ __('Select') }}</option>
                                <option value="male">{{ __('Male') }}</option>
                                <option value="female">{{ __('Female') }}</option>
                                <option value="other">{{ __('Other') }}</option>
                            </select>
                            <x-input-error :messages="$errors->get('gender')" />
                        </div>
                    @endif

                    <button type="submit" class="k-btn k-btn--block mt-2" wire:loading.attr="aria-busy" wire:target="link">{{ __('Request the link') }}</button>
                </form>
            @endif
        </div>
    </div>
</div>
