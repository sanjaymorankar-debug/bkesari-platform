<?php

use App\Livewire\Concerns\SendsMailSafely;
use App\Mail\StaffCredentialsMail;
use App\Models\District;
use App\Models\School;
use App\Models\SchoolStaff;
use App\Models\State;
use App\Models\User;
use App\Services\AIAssistService;
use Illuminate\Auth\Events\Registered;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    use SendsMailSafely;

    // Admin account fields — only used if the visitor isn't already logged in.
    public string $adminName = '';
    public string $adminEmail = '';
    public string $adminPassword = '';
    public string $adminPassword_confirmation = '';

    // School fields
    public string $name = '';
    public string $board = 'STATE';
    public string $managementType = 'private';
    public string $stateId = '';
    public string $districtId = '';
    public string $address = '';
    public string $city = '';
    public string $pincode = '';
    public string $phone = '';
    public string $email = '';

    /** @var array<int, array{name: string, email: string, designation: string}> */
    public array $additionalStaff = [];

    public bool $submitted = false;
    public array $generatedCredentials = [];

    public ?int $possibleDuplicateSchoolId = null;
    public ?string $possibleDuplicateSchoolName = null;

    public function mount(): void
    {
        $this->addStaffRow();
    }

    /**
     * Advisory only (spec section AF) — warns, never blocks, a registrant
     * whose school name/city closely matches one already on the platform.
     */
    public function checkDuplicateSchool(): void
    {
        $duplicate = app(AIAssistService::class)->findPossibleDuplicateSchool($this->name, $this->city);
        $this->possibleDuplicateSchoolId = $duplicate?->id;
        $this->possibleDuplicateSchoolName = $duplicate?->name;
    }

    public function addStaffRow(): void
    {
        $this->additionalStaff[] = ['name' => '', 'email' => '', 'designation' => 'Operator'];
    }

    public function removeStaffRow(int $index): void
    {
        unset($this->additionalStaff[$index]);
        $this->additionalStaff = array_values($this->additionalStaff);
    }

    /**
     * Whoever registers a school becomes its School Admin immediately, even
     * while the school itself is pending verification — someone has to be
     * able to manage the profile and respond to complaints once it's live.
     * The school itself does not appear in public search/ratings until a
     * District/State Officer marks it verified (spec section O).
     */
    public function register(): void
    {
        // Drop blank rows before validating — an untouched default row has
        // name/email as empty strings, not null, so a "nullable" rule alone
        // wouldn't skip it.
        $this->additionalStaff = array_values(array_filter(
            $this->additionalStaff,
            fn ($staff) => trim($staff['name'] ?? '') !== '' || trim($staff['email'] ?? '') !== ''
        ));

        $rules = [
            'name' => ['required', 'string', 'max:255'],
            'board' => ['required', 'in:CBSE,ICSE,STATE,IB,OTHER'],
            'managementType' => ['required', 'in:government,aided,private,international'],
            'stateId' => ['required', 'exists:states,id'],
            'districtId' => ['required', 'exists:districts,id'],
            'address' => ['required', 'string', 'max:255'],
            'city' => ['required', 'string', 'max:255'],
            'pincode' => ['required', 'string', 'max:10'],
            'phone' => ['nullable', 'string', 'max:20'],
            'email' => ['nullable', 'email', 'max:255'],
            'additionalStaff.*.name' => ['nullable', 'string', 'max:255'],
            'additionalStaff.*.email' => ['nullable', 'email', 'max:255', 'distinct'],
            'additionalStaff.*.designation' => ['nullable', 'string', 'max:60'],
        ];

        if (! Auth::check()) {
            $rules['adminName'] = ['required', 'string', 'max:255'];
            $rules['adminEmail'] = ['required', 'email', 'max:255', 'unique:users,email'];
            $rules['adminPassword'] = ['required', 'confirmed', Rules\Password::defaults()];
        }

        $validated = $this->validate($rules, [], [
            'adminPassword_confirmation' => 'adminPassword confirmation',
        ]);

        if (Auth::check()) {
            $admin = Auth::user();
        } else {
            $admin = User::create([
                'name' => $validated['adminName'],
                'email' => $validated['adminEmail'],
                'password' => Hash::make($validated['adminPassword']),
            ]);
            event(new Registered($admin));
        }

        if (! $admin->hasRole('school_admin')) {
            $admin->assignRole('school_admin');
        }

        $school = School::create([
            'school_code' => 'SCH-'.strtoupper(Str::random(8)),
            'name' => $validated['name'],
            'board' => $validated['board'],
            'management_type' => $validated['managementType'],
            'state_id' => $validated['stateId'],
            'district_id' => $validated['districtId'],
            'address' => $validated['address'],
            'city' => $validated['city'],
            'pincode' => $validated['pincode'],
            'phone' => $validated['phone'] ?: null,
            'email' => $validated['email'] ?: null,
            'recognition_status' => 'pending',
        ]);

        SchoolStaff::create(['user_id' => $admin->id, 'school_id' => $school->id, 'designation' => 'Principal']);

        $credentials = [];
        foreach ($this->additionalStaff as $staff) {
            if (empty($staff['email']) || empty($staff['name'])) {
                continue;
            }

            $tempPassword = Str::password(12);
            $staffUser = User::firstOrCreate(
                ['email' => $staff['email']],
                ['name' => $staff['name'], 'password' => Hash::make($tempPassword)]
            );

            if (! $staffUser->hasRole('school_admin')) {
                $staffUser->assignRole('school_admin');
            }

            SchoolStaff::firstOrCreate(
                ['user_id' => $staffUser->id, 'school_id' => $school->id],
                ['designation' => $staff['designation'] ?: 'Operator']
            );

            $credentials[] = [
                'name' => $staff['name'],
                'email' => $staff['email'],
                'password' => $tempPassword,
            ];

            $this->tryMail($staff['email'], fn () => new StaffCredentialsMail($staff['name'], $school->name, $tempPassword));
        }

        if (! Auth::check()) {
            Auth::login($admin);
        }

        $this->generatedCredentials = $credentials;
        $this->submitted = true;
    }

    public function with(): array
    {
        return [
            'states' => State::orderBy('name')->get(),
            'districts' => $this->stateId !== ''
                ? District::where('state_id', $this->stateId)->orderBy('name')->get()
                : collect(),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Register a School</h2>
    </x-slot>

    <div class="py-8 max-w-3xl mx-auto sm:px-6 lg:px-8">
        @if ($submitted)
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-lg text-green-700">School registered — pending verification</h3>
                <p class="text-sm text-gray-600 mt-2">
                    Your school has been submitted and is now <strong>pending</strong> review by a District/State Officer.
                    It won't appear in public search or ratings until it's verified, but you can manage its profile
                    and respond to complaints from your School Dashboard right away.
                </p>

                @if (count($generatedCredentials))
                    <div class="mt-4 border-t pt-4">
                        <h4 class="font-medium text-gray-800">Additional staff accounts created</h4>
                        <p class="text-xs text-gray-500 mb-2">This test environment doesn't send real email — share these temporary passwords with each person directly. They should change it after first login.</p>
                        <table class="w-full text-sm">
                            <thead><tr class="text-left text-gray-500"><th>Name</th><th>Email</th><th>Temporary Password</th></tr></thead>
                            <tbody>
                                @foreach ($generatedCredentials as $cred)
                                    <tr class="border-t">
                                        <td class="py-1">{{ $cred['name'] }}</td>
                                        <td class="py-1">{{ $cred['email'] }}</td>
                                        <td class="py-1 font-mono">{{ $cred['password'] }}</td>
                                    </tr>
                                @endforeach
                            </tbody>
                        </table>
                    </div>
                @endif

                <a href="{{ route('dashboard') }}" wire:navigate class="inline-block mt-6 px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">Go to School Dashboard</a>
            </div>
        @else
            <div class="bg-white rounded-lg shadow p-6">
                <p class="text-sm text-gray-500 mb-6">
                    Whoever registers here becomes the School Admin for this school. Government roles
                    (District/State/National Officer) and System Admin accounts are provisioned separately and
                    can't be created through this form.
                </p>

                <form wire:submit="register" class="space-y-6">
                    @unless (auth()->check())
                        <div>
                            <h3 class="font-semibold text-gray-900 mb-3">Your admin account</h3>
                            <div class="space-y-4">
                                <div>
                                    <x-input-label for="adminName" value="Your name" />
                                    <x-text-input wire:model="adminName" id="adminName" class="mt-1 w-full" />
                                    <x-input-error :messages="$errors->get('adminName')" class="mt-2" />
                                </div>
                                <div>
                                    <x-input-label for="adminEmail" value="Your email" />
                                    <x-text-input wire:model="adminEmail" id="adminEmail" type="email" class="mt-1 w-full" />
                                    <x-input-error :messages="$errors->get('adminEmail')" class="mt-2" />
                                </div>
                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <x-input-label for="adminPassword" value="Password" />
                                        <x-text-input wire:model="adminPassword" id="adminPassword" type="password" class="mt-1 w-full" />
                                        <x-input-error :messages="$errors->get('adminPassword')" class="mt-2" />
                                    </div>
                                    <div>
                                        <x-input-label for="adminPassword_confirmation" value="Confirm password" />
                                        <x-text-input wire:model="adminPassword_confirmation" id="adminPassword_confirmation" type="password" class="mt-1 w-full" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    @endunless

                    <div>
                        <h3 class="font-semibold text-gray-900 mb-3">School details</h3>
                        <div class="space-y-4">
                            <div>
                                <x-input-label for="name" value="School name" />
                                <x-text-input wire:model.blur="name" wire:blur="checkDuplicateSchool" id="name" class="mt-1 w-full" />
                                <x-input-error :messages="$errors->get('name')" class="mt-2" />
                                @if ($possibleDuplicateSchoolId)
                                    <p class="text-xs text-yellow-700 bg-yellow-50 rounded p-2 mt-2">
                                        "{{ $possibleDuplicateSchoolName }}" is already registered in this city. You can still
                                        continue — this is just a heads-up to avoid accidental duplicate registrations.
                                    </p>
                                @endif
                            </div>
                            <div class="grid grid-cols-2 gap-4">
                                <div>
                                    <x-input-label for="board" value="Board" />
                                    <select wire:model="board" id="board" class="border-gray-300 rounded-md shadow-sm mt-1 w-full">
                                        <option value="CBSE">CBSE</option>
                                        <option value="ICSE">ICSE</option>
                                        <option value="STATE">STATE</option>
                                        <option value="IB">IB</option>
                                        <option value="OTHER">OTHER</option>
                                    </select>
                                </div>
                                <div>
                                    <x-input-label for="managementType" value="Management type" />
                                    <select wire:model="managementType" id="managementType" class="border-gray-300 rounded-md shadow-sm mt-1 w-full">
                                        <option value="government">Government</option>
                                        <option value="aided">Aided</option>
                                        <option value="private">Private</option>
                                        <option value="international">International</option>
                                    </select>
                                </div>
                            </div>
                            <div class="grid grid-cols-2 gap-4">
                                <div>
                                    <x-input-label for="stateId" value="State" />
                                    <select wire:model.live="stateId" id="stateId" class="border-gray-300 rounded-md shadow-sm mt-1 w-full">
                                        <option value="">Select state</option>
                                        @foreach ($states as $state)
                                            <option value="{{ $state->id }}">{{ $state->name }}</option>
                                        @endforeach
                                    </select>
                                    <x-input-error :messages="$errors->get('stateId')" class="mt-2" />
                                </div>
                                <div>
                                    <x-input-label for="districtId" value="District" />
                                    <select wire:model="districtId" id="districtId" class="border-gray-300 rounded-md shadow-sm mt-1 w-full">
                                        <option value="">Select district</option>
                                        @foreach ($districts as $district)
                                            <option value="{{ $district->id }}">{{ $district->name }}</option>
                                        @endforeach
                                    </select>
                                    <x-input-error :messages="$errors->get('districtId')" class="mt-2" />
                                </div>
                            </div>
                            <div>
                                <x-input-label for="address" value="Address" />
                                <x-text-input wire:model="address" id="address" class="mt-1 w-full" />
                                <x-input-error :messages="$errors->get('address')" class="mt-2" />
                            </div>
                            <div class="grid grid-cols-2 gap-4">
                                <div>
                                    <x-input-label for="city" value="City" />
                                    <x-text-input wire:model.blur="city" wire:blur="checkDuplicateSchool" id="city" class="mt-1 w-full" />
                                    <x-input-error :messages="$errors->get('city')" class="mt-2" />
                                </div>
                                <div>
                                    <x-input-label for="pincode" value="PIN code" />
                                    <x-text-input wire:model="pincode" id="pincode" class="mt-1 w-full" />
                                    <x-input-error :messages="$errors->get('pincode')" class="mt-2" />
                                </div>
                            </div>
                            <div class="grid grid-cols-2 gap-4">
                                <div>
                                    <x-input-label for="phone" value="School phone (optional)" />
                                    <x-text-input wire:model="phone" id="phone" class="mt-1 w-full" />
                                </div>
                                <div>
                                    <x-input-label for="email" value="School email (optional)" />
                                    <x-text-input wire:model="email" id="email" type="email" class="mt-1 w-full" />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <h3 class="font-semibold text-gray-900 mb-1">Add more admins / operators (optional)</h3>
                        <p class="text-xs text-gray-500 mb-3">Each entry gets its own account with a temporary password, shown after you submit.</p>
                        @foreach ($additionalStaff as $index => $staff)
                            <div class="grid grid-cols-7 gap-2 mb-2 items-start">
                                <div class="col-span-3">
                                    <x-text-input wire:model="additionalStaff.{{ $index }}.name" placeholder="Name" class="w-full" />
                                    <x-input-error :messages="$errors->get('additionalStaff.'.$index.'.name')" class="mt-1" />
                                </div>
                                <div class="col-span-3">
                                    <x-text-input wire:model="additionalStaff.{{ $index }}.email" placeholder="Email" type="email" class="w-full" />
                                    <x-input-error :messages="$errors->get('additionalStaff.'.$index.'.email')" class="mt-1" />
                                </div>
                                <div class="col-span-1 flex gap-1">
                                    <select wire:model="additionalStaff.{{ $index }}.designation" class="border-gray-300 rounded-md shadow-sm text-sm w-full">
                                        <option value="Operator">Operator</option>
                                        <option value="Admin">Admin</option>
                                        <option value="Principal">Principal</option>
                                    </select>
                                </div>
                            </div>
                        @endforeach
                        <button type="button" wire:click="addStaffRow" class="text-sm text-indigo-600 hover:underline">+ Add another</button>
                    </div>

                    <x-primary-button>Register School</x-primary-button>
                </form>
            </div>
        @endif
    </div>
</div>
