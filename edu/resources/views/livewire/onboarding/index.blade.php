<?php

use App\Livewire\Concerns\SendsMailSafely;
use App\Mail\StaffCredentialsMail;
use App\Models\ParentSchoolRelationship;
use App\Models\School;
use App\Models\StudentProfile;
use App\Models\StudentSchoolRelationship;
use App\Models\TeacherSchoolRelationship;
use App\Models\User;
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
            $this->validate(['childEmail' => ['required', 'email', 'exists:users,email']]);

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
            'childEmail' => ['required', 'email', 'max:255', 'unique:users,email'],
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
            $query->where('name', 'like', "%{$this->search}%");
        }

        return [
            'schools' => $query->limit(50)->get(['id', 'name', 'city']),
            'role' => Auth::user()->getRoleNames()->first(),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Link Your School</h2>
    </x-slot>

    <div class="py-8 max-w-xl mx-auto sm:px-6 lg:px-8">
        <div class="bg-white rounded-lg shadow p-6">
            @if ($linked)
                <h3 class="font-semibold text-lg text-green-700">Request sent — pending verification</h3>
                <p class="text-sm text-gray-600 mt-2">
                    The school's admin needs to approve this link before you can submit complaints or ratings for it.
                    You can still browse schools and track any existing complaints in the meantime.
                </p>

                @if ($childTempPassword)
                    <div class="mt-4 border-t pt-4">
                        <h4 class="font-medium text-gray-800">Your child's account</h4>
                        <p class="text-xs text-gray-500 mb-2">This test environment doesn't send real email — share these details with your child directly. They should change the password after first login.</p>
                        <p class="text-sm"><strong>Email:</strong> {{ $childEmail }}</p>
                        <p class="text-sm font-mono"><strong>Temporary password:</strong> {{ $childTempPassword }}</p>
                    </div>
                @endif

                <a href="{{ route('dashboard') }}" wire:navigate class="inline-block mt-6 px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">Go to Dashboard</a>
            @else
                <p class="text-sm text-gray-500 mb-6">
                    Link your account to a school as a <strong>{{ ucfirst($role) }}</strong>. The school's admin
                    reviews and approves this before you can submit anything for it — your identity is never shown
                    to the school, only that you're a verified {{ $role }}.
                </p>

                <form wire:submit="link" class="space-y-4">
                    <div>
                        <x-input-label for="search" value="Search school" />
                        <x-text-input wire:model.live.debounce.300ms="search" id="search" class="mt-1 w-full" placeholder="Type a school name..." />
                    </div>

                    <div>
                        <x-input-label for="schoolId" value="School" />
                        <select wire:model="schoolId" id="schoolId" class="border-gray-300 rounded-md shadow-sm mt-1 w-full">
                            <option value="">Select school</option>
                            @foreach ($schools as $school)
                                <option value="{{ $school->id }}">{{ $school->name }} ({{ $school->city }})</option>
                            @endforeach
                        </select>
                        <x-input-error :messages="$errors->get('schoolId')" class="mt-2" />
                    </div>

                    @if ($role === 'parent')
                        <div>
                            <x-input-label for="phone" value="Phone number" />
                            <x-text-input wire:model="phone" id="phone" class="mt-1 w-full" />
                            <x-input-error :messages="$errors->get('phone')" class="mt-2" />
                        </div>

                        <div class="border-t pt-4">
                            <label class="flex items-center gap-2 text-sm font-medium text-gray-700">
                                <input type="checkbox" wire:model.live="addChild"> Also register my child at this school
                            </label>

                            @if ($addChild)
                                <div class="mt-3 space-y-3 pl-1">
                                    <div class="flex gap-4 text-sm">
                                        <label class="flex items-center gap-1"><input type="radio" wire:model.live="childMode" value="new"> Create a new account for my child</label>
                                        <label class="flex items-center gap-1"><input type="radio" wire:model.live="childMode" value="existing"> My child already has an account</label>
                                    </div>

                                    @if ($childMode === 'existing')
                                        <div>
                                            <x-input-label for="childEmail" value="Child's email" />
                                            <x-text-input wire:model="childEmail" id="childEmail" type="email" class="mt-1 w-full" />
                                            <x-input-error :messages="$errors->get('childEmail')" class="mt-2" />
                                        </div>
                                    @else
                                        <div>
                                            <x-input-label for="childName" value="Child's name" />
                                            <x-text-input wire:model="childName" id="childName" class="mt-1 w-full" />
                                            <x-input-error :messages="$errors->get('childName')" class="mt-2" />
                                        </div>
                                        <div>
                                            <x-input-label for="childEmail" value="Child's email" />
                                            <x-text-input wire:model="childEmail" id="childEmail" type="email" class="mt-1 w-full" />
                                            <x-input-error :messages="$errors->get('childEmail')" class="mt-2" />
                                        </div>
                                        <div>
                                            <x-input-label for="childDateOfBirth" value="Date of birth" />
                                            <x-text-input wire:model="childDateOfBirth" id="childDateOfBirth" type="date" class="mt-1 w-full" />
                                            <x-input-error :messages="$errors->get('childDateOfBirth')" class="mt-2" />
                                        </div>
                                        <div>
                                            <x-input-label for="childGender" value="Gender" />
                                            <select wire:model="childGender" id="childGender" class="border-gray-300 rounded-md shadow-sm mt-1 w-full">
                                                <option value="">Select</option>
                                                <option value="male">Male</option>
                                                <option value="female">Female</option>
                                                <option value="other">Other</option>
                                            </select>
                                            <x-input-error :messages="$errors->get('childGender')" class="mt-2" />
                                        </div>
                                        <div>
                                            <x-input-label for="childClassGrade" value="Class / Grade" />
                                            <x-text-input wire:model="childClassGrade" id="childClassGrade" class="mt-1 w-full" placeholder="e.g. 8" />
                                            <x-input-error :messages="$errors->get('childClassGrade')" class="mt-2" />
                                        </div>
                                    @endif
                                </div>
                            @endif
                        </div>
                    @elseif ($role === 'student')
                        <div>
                            <x-input-label for="dateOfBirth" value="Date of birth" />
                            <x-text-input wire:model="dateOfBirth" id="dateOfBirth" type="date" class="mt-1 w-full" />
                            <x-input-error :messages="$errors->get('dateOfBirth')" class="mt-2" />
                        </div>
                        <div>
                            <x-input-label for="gender" value="Gender" />
                            <select wire:model="gender" id="gender" class="border-gray-300 rounded-md shadow-sm mt-1 w-full">
                                <option value="">Select</option>
                                <option value="male">Male</option>
                                <option value="female">Female</option>
                                <option value="other">Other</option>
                            </select>
                            <x-input-error :messages="$errors->get('gender')" class="mt-2" />
                        </div>
                        <div>
                            <x-input-label for="classGrade" value="Class / Grade" />
                            <x-text-input wire:model="classGrade" id="classGrade" class="mt-1 w-full" placeholder="e.g. 8" />
                            <x-input-error :messages="$errors->get('classGrade')" class="mt-2" />
                        </div>
                    @endif

                    <x-primary-button>Request Link</x-primary-button>
                </form>
            @endif
        </div>
    </div>
</div>
