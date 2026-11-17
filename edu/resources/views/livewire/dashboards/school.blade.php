<?php

use App\Livewire\Concerns\SendsMailSafely;
use App\Mail\SchoolInvitationMail;
use App\Models\Invitation;
use App\Models\ParentSchoolRelationship;
use App\Models\SchoolStaff;
use App\Models\StudentSchoolRelationship;
use App\Models\TeacherSchoolRelationship;
use App\Notifications\RelationshipApproved;
use App\Rules\NotReservedEmail;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    use SendsMailSafely;

    public string $inviteEmail = '';
    public string $inviteRole = 'parent';
    public string $inviteStudentName = '';
    public ?string $inviteLink = null;

    /**
     * A school-initiated invite is pre-trusted — the resulting relationship
     * is created 'verified' on acceptance, no separate approval step (the
     * invite itself is the vetting). Link shown on-screen since this
     * environment has no real mail sending.
     */
    public function sendInvite(): void
    {
        $school = $this->myFirstSchool();
        abort_unless($school, 404);

        $validated = $this->validate([
            'inviteEmail' => ['required', 'email', 'max:255', new NotReservedEmail],
            'inviteRole' => ['required', 'in:parent,student,teacher'],
            'inviteStudentName' => ['nullable', 'string', 'max:255'],
        ]);

        $invitation = Invitation::create([
            'school_id' => $school->id,
            'invited_by_user_id' => Auth::id(),
            'email' => $validated['inviteEmail'],
            'role' => $validated['inviteRole'],
            'student_name' => $validated['inviteStudentName'] ?: null,
            'token' => Invitation::generateToken(),
            'status' => 'pending',
        ]);

        $this->inviteLink = route('invitations.show', $invitation->token);
        $this->tryMail($invitation->email, fn () => new SchoolInvitationMail($invitation->load('school'), $this->inviteLink));

        $this->inviteEmail = '';
        $this->inviteStudentName = '';
    }

    public function revokeInvite(int $id): void
    {
        $invitation = Invitation::findOrFail($id);
        $mySchoolIds = SchoolStaff::where('user_id', Auth::id())->pluck('school_id');
        abort_unless($mySchoolIds->contains($invitation->school_id), 403);

        $invitation->update(['status' => 'revoked']);
    }

    private function myFirstSchool()
    {
        $schoolIds = SchoolStaff::where('user_id', Auth::id())->pluck('school_id');

        return \App\Models\School::whereIn('id', $schoolIds)->first();
    }

    public function approveParent(int $id): void
    {
        $relationship = $this->authorizeRelationship(ParentSchoolRelationship::findOrFail($id));
        $relationship->update(['status' => 'verified', 'verified_at' => now()]);
        $relationship->user?->notify(new RelationshipApproved($relationship->school, 'parent'));
    }

    public function rejectParent(int $id): void
    {
        $this->authorizeRelationship(ParentSchoolRelationship::findOrFail($id))->update(['status' => 'rejected']);
    }

    public function approveStudent(int $id): void
    {
        $relationship = $this->authorizeRelationship(StudentSchoolRelationship::findOrFail($id));
        $relationship->update(['status' => 'verified', 'verified_at' => now()]);
        $relationship->user?->notify(new RelationshipApproved($relationship->school, 'student'));
    }

    public function rejectStudent(int $id): void
    {
        $this->authorizeRelationship(StudentSchoolRelationship::findOrFail($id))->update(['status' => 'rejected']);
    }

    public function approveTeacher(int $id): void
    {
        $relationship = $this->authorizeRelationship(TeacherSchoolRelationship::findOrFail($id));
        $relationship->update(['status' => 'verified', 'verified_at' => now()]);
        $relationship->user?->notify(new RelationshipApproved($relationship->school, 'teacher'));
    }

    public function rejectTeacher(int $id): void
    {
        $this->authorizeRelationship(TeacherSchoolRelationship::findOrFail($id))->update(['status' => 'rejected']);
    }

    /**
     * Every approve/reject action re-checks the relationship's school_id
     * against this admin's own school_staff assignment — a school admin
     * must never be able to approve a link for a different school.
     */
    private function authorizeRelationship(ParentSchoolRelationship|StudentSchoolRelationship|TeacherSchoolRelationship $relationship): ParentSchoolRelationship|StudentSchoolRelationship|TeacherSchoolRelationship
    {
        $mySchoolIds = SchoolStaff::where('user_id', Auth::id())->pluck('school_id');
        abort_unless($mySchoolIds->contains($relationship->school_id), 403);

        return $relationship;
    }

    public function with(): array
    {
        $schoolIds = SchoolStaff::where('user_id', Auth::id())->pluck('school_id');
        $school = \App\Models\School::whereIn('id', $schoolIds)->with('latestQualityScore')->first();

        $complaints = $school
            ? $school->complaints()->with('category:id,name')->latest()->limit(20)->get()
            : collect();

        $stats = [
            'open' => $complaints->whereNotIn('status', ['resolved', 'closed'])->count(),
            'overdue' => $complaints->where('status', 'submitted')->where('created_at', '<', now()->subDays(7))->count(),
            'resolved' => $complaints->whereIn('status', ['resolved', 'closed'])->count(),
        ];

        $pendingParents = $school ? ParentSchoolRelationship::where('school_id', $school->id)->where('status', 'pending')->with('user:id,name')->get() : collect();
        $pendingStudents = $school ? StudentSchoolRelationship::where('school_id', $school->id)->where('status', 'pending')->with('user:id,name')->get() : collect();
        $pendingTeachers = $school ? TeacherSchoolRelationship::where('school_id', $school->id)->where('status', 'pending')->with('user:id,name')->get() : collect();

        $sentInvitations = $school ? Invitation::where('school_id', $school->id)->latest()->limit(10)->get() : collect();

        return compact('school', 'complaints', 'stats', 'pendingParents', 'pendingStudents', 'pendingTeachers', 'sentInvitations');
    }

    public function rendering($view): void
    {
        $view->title(__('School Dashboard'));
    }
}; ?>

<div>
    <x-slot name="header">
        <p class="k-eyebrow"><x-k-icon name="school" /> {{ __('School Dashboard') }}</p>
        <h1>{{ $school?->name ?? __('School Dashboard') }}</h1>
        @if ($school)
            <div class="edu-page-head__row">
                <span class="k-chip {{ $school->recognition_status === 'verified' ? 'k-chip--success' : 'k-chip--warning' }}">{{ __(ucfirst(str_replace('_', ' ', $school->recognition_status))) }}</span>
                <a href="{{ route('schools.show', $school) }}" wire:navigate class="k-link-arrow">{{ __('View public profile') }} <x-k-icon name="arrow-right" /></a>
            </div>
        @endif
    </x-slot>

    <div class="edu-dash">
        @if (! $school)
            <div class="k-card k-empty">
                <span class="k-picon k-picon--lg"><x-k-icon name="school" /></span>
                <h2 class="edu-empty-title">{{ __('No school is linked to your account yet.') }}</h2>
                <p>{{ __('Register your school, or ask the person who registered it to add you as staff.') }}</p>
                <a href="{{ route('schools.register') }}" wire:navigate class="k-btn">{{ __('Register a School') }}</a>
            </div>
        @else
            @if ($school->recognition_status !== 'verified')
                <div class="k-banner k-banner--warning" role="status">
                    <x-k-icon name="pending" />
                    <p>{{ __('This school is not verified yet, so it won’t appear in public search or ratings until a District or State Officer verifies it. You can still manage its profile and respond to complaints in the meantime.') }}</p>
                </div>
            @endif

            <ul class="k-stats edu-stats" role="list" aria-label="{{ __('At a glance') }}">
                <li class="k-stat">
                    <span class="k-stat__value">{{ $school->latestQualityScore?->score ?? '—' }}</span>
                    <span class="k-stat__label">{{ __('School Quality Index') }}</span>
                </li>
                <li class="k-stat">
                    <span class="k-stat__value">{{ $stats['open'] }}</span>
                    <span class="k-stat__label">{{ __('Open complaints') }}</span>
                </li>
                <li class="k-stat {{ $stats['overdue'] > 0 ? 'edu-stat--danger' : '' }}">
                    <span class="k-stat__value">{{ $stats['overdue'] }}</span>
                    <span class="k-stat__label">{{ __('Overdue') }}</span>
                    <span class="k-stat__source">{{ __('No response for more than 7 days') }}</span>
                </li>
                <li class="k-stat">
                    <span class="k-stat__value">{{ $stats['resolved'] }}</span>
                    <span class="k-stat__label">{{ __('Resolved') }}</span>
                </li>
            </ul>

            @php $pendingTotal = $pendingParents->count() + $pendingStudents->count() + $pendingTeachers->count(); @endphp
            <section class="k-card edu-panel" aria-labelledby="pending-title">
                <div class="edu-panel__head">
                    <h2 id="pending-title">{{ __('Pending verifications') }}</h2>
                    @if ($pendingTotal > 0)
                        <span class="k-badge" aria-hidden="true">{{ $pendingTotal }}</span>
                        <span class="k-sr-only">{{ trans_choice(':count person waiting|:count people waiting', $pendingTotal) }}</span>
                    @endif
                </div>
                <p class="edu-panel__intro">{{ __('Parents, students and teachers who asked to link their account to this school. Approve only people you can confirm belong here.') }}</p>

                @if ($pendingTotal === 0)
                    <p class="edu-none"><x-k-icon name="check" class="k-icon--sm" /> {{ __('No one is waiting for approval.') }}</p>
                @else
                    <ul class="edu-rows" role="list">
                        @foreach ([['parent', $pendingParents, 'Parent'], ['student', $pendingStudents, 'Student'], ['teacher', $pendingTeachers, 'Teacher']] as [$kind, $list, $label])
                            @foreach ($list as $rel)
                                <li wire:key="pending-{{ $kind }}-{{ $rel->id }}">
                                    <div class="edu-rows__main">
                                        <p class="edu-rows__title">{{ $rel->user->name }}</p>
                                        <p class="edu-rows__sub">
                                            {{ __($label) }}
                                            @if ($kind === 'student' && $rel->class_grade)
                                                &middot; {{ __('Class :grade', ['grade' => $rel->class_grade]) }}
                                            @endif
                                        </p>
                                    </div>
                                    <div class="edu-actions">
                                        <button type="button" wire:click="approve{{ ucfirst($kind) }}({{ $rel->id }})" class="k-btn k-btn--soft"
                                            aria-label="{{ __('Approve :name as :role', ['name' => $rel->user->name, 'role' => __($label)]) }}"><x-k-icon name="check" /> {{ __('Approve') }}</button>
                                        <button type="button" wire:click="reject{{ ucfirst($kind) }}({{ $rel->id }})" class="k-btn k-btn--secondary"
                                            aria-label="{{ __('Reject :name as :role', ['name' => $rel->user->name, 'role' => __($label)]) }}">{{ __('Reject') }}</button>
                                    </div>
                                </li>
                            @endforeach
                        @endforeach
                    </ul>
                @endif
            </section>

            <section aria-labelledby="manage-title">
                <h2 id="manage-title" class="edu-section-title">{{ __('Manage this school') }}</h2>
                <ul class="edu-tiles" role="list">
                    @foreach ([
                        ['fees.manage', 'Fees & charges', 'Publish this year’s fees, and give a reason for any change.', 'calendar'],
                        ['facilities.manage', 'Facilities', 'What the school offers, next to what families report.', 'school'],
                        ['courses.manage', 'Courses', 'The courses families can rate this year.', 'book'],
                        ['exams.manage', 'Exams & coaching', 'External exams and coaching, with what they cost.', 'clock'],
                        ['academic-records.index', 'Academic records', 'Results that feed teachers’ private index.', 'grid'],
                        ['improvement.show', 'Improvement over time', 'How the school compares with its own past years.', 'repeat'],
                    ] as [$route, $title, $text, $icon])
                        <li class="k-card edu-tile">
                            <span class="k-picon k-picon--sm"><x-k-icon :name="$icon" /></span>
                            <div class="min-w-0">
                                <a href="{{ route($route, $school) }}" wire:navigate class="edu-stretch edu-tile__title">{{ __($title) }}</a>
                                <p>{{ __($text) }}</p>
                            </div>
                            <x-k-icon name="arrow-right" class="edu-tile__arrow" />
                        </li>
                    @endforeach
                </ul>
            </section>

            <section class="k-card edu-panel" aria-labelledby="invite-title">
                <h2 id="invite-title" class="edu-panel__title">{{ __('Invite a member') }}</h2>
                <p class="edu-panel__intro">{{ __('School-initiated invites are trusted immediately — no separate approval step once accepted.') }}</p>

                @if ($inviteLink)
                    <div class="k-banner k-banner--success" role="status">
                        <x-k-icon name="check" />
                        <div class="min-w-0">
                            <p>{{ __('Invitation created. If the email does not arrive, share this link directly:') }}</p>
                            <p class="font-mono text-sm break-all">{{ $inviteLink }}</p>
                        </div>
                    </div>
                @endif

                <form wire:submit="sendInvite" class="edu-invite" novalidate>
                    <div class="k-field">
                        <x-input-label for="inviteEmail" :value="__('Email')" />
                        <x-text-input wire:model="inviteEmail" id="inviteEmail" type="email" autocomplete="off" />
                        <x-input-error :messages="$errors->get('inviteEmail')" />
                    </div>
                    <div class="k-field">
                        <x-input-label for="inviteRole" :value="__('Role')" />
                        <select wire:model="inviteRole" id="inviteRole" class="k-select">
                            <option value="parent">{{ __('Parent') }}</option>
                            <option value="student">{{ __('Student') }}</option>
                            <option value="teacher">{{ __('Teacher') }}</option>
                        </select>
                    </div>
                    <div class="k-field">
                        <x-input-label for="inviteStudentName" :value="__('For student (optional)')" />
                        <x-text-input wire:model="inviteStudentName" id="inviteStudentName" aria-describedby="inviteStudentName-hint" />
                        <p id="inviteStudentName-hint" class="k-hint">{{ __('The child’s name, when you invite a parent.') }}</p>
                    </div>
                    <div class="edu-invite__submit">
                        <button type="submit" class="k-btn" wire:loading.attr="aria-busy" wire:target="sendInvite"><x-k-icon name="mail" /> {{ __('Send invite') }}</button>
                    </div>
                </form>

                @if ($sentInvitations->isNotEmpty())
                    <h3 class="edu-subhead">{{ __('Recent invitations') }}</h3>
                    <ul class="edu-rows" role="list">
                        @foreach ($sentInvitations as $invite)
                            <li wire:key="invite-{{ $invite->id }}">
                                <div class="edu-rows__main">
                                    <p class="edu-rows__title break-all">{{ $invite->email }}</p>
                                    <p class="edu-rows__sub">{{ __(ucfirst($invite->role)) }}{{ $invite->student_name ? ' · '.$invite->student_name : '' }}</p>
                                </div>
                                <div class="edu-actions">
                                    <span class="k-chip {{ $invite->status === 'accepted' ? 'k-chip--success' : ($invite->status === 'revoked' ? '' : 'k-chip--warning') }}">{{ __(ucfirst($invite->status)) }}</span>
                                    @if ($invite->status === 'pending')
                                        <button type="button" wire:click="revokeInvite({{ $invite->id }})" class="k-btn k-btn--ghost"
                                            aria-label="{{ __('Revoke the invitation to :email', ['email' => $invite->email]) }}">{{ __('Revoke') }}</button>
                                    @endif
                                </div>
                            </li>
                        @endforeach
                    </ul>
                @endif
            </section>

            <section class="k-card edu-panel" aria-labelledby="complaints-title">
                <h2 id="complaints-title" class="edu-panel__title">{{ __('Complaints') }}</h2>
                <p class="edu-panel__intro">{{ __('The 20 most recent. You see what was raised, never who raised it.') }}</p>
                @if ($complaints->isEmpty())
                    <p class="edu-none">{{ __('No complaints yet.') }}</p>
                @else
                    <ul class="edu-rows" role="list">
                        @foreach ($complaints as $complaint)
                            <li class="edu-rows__item--link">
                                <div class="edu-rows__main">
                                    <a href="{{ route('complaints.show', $complaint) }}" wire:navigate class="edu-stretch edu-rows__title">{{ $complaint->category->name }}</a>
                                    <p class="edu-rows__sub">{{ $complaint->complaint_number }} &middot; {{ $complaint->created_at->format('j M Y') }}</p>
                                </div>
                                <x-complaint-status :status="$complaint->status" />
                            </li>
                        @endforeach
                    </ul>
                @endif
            </section>
        @endif
    </div>
</div>
