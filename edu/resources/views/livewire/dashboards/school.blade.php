<?php

use App\Livewire\Concerns\SendsMailSafely;
use App\Mail\SchoolInvitationMail;
use App\Models\AuditLog;
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

        // A school-initiated invite is pre-trusted: accepting it creates the
        // relationship already `verified`, with no approval step. Inviting
        // your own address would therefore be the same self-grant the
        // approval queue refuses, by a different door. Blocked here for a
        // clear message, and again in the acceptance itself, which is where
        // the standing is actually minted.
        if (strcasecmp($validated['inviteEmail'], (string) Auth::user()->email) === 0) {
            $this->addError('inviteEmail', 'You cannot invite your own address — another member of staff has to decide your own link to this school.');

            return;
        }

        $invitation = Invitation::create([
            'school_id' => $school->id,
            'invited_by_user_id' => Auth::id(),
            'email' => $validated['inviteEmail'],
            'role' => $validated['inviteRole'],
            'student_name' => $validated['inviteStudentName'] ?: null,
            'token' => Invitation::generateToken(),
            'status' => 'pending',
        ]);

        AuditLog::record('invitation.created', Auth::id(), $invitation, [
            'school_id' => $school->id,
            'role' => $invitation->role,
            'email' => $invitation->email,
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

        AuditLog::record('invitation.revoked', Auth::id(), $invitation, [
            'school_id' => $invitation->school_id,
            'role' => $invitation->role,
        ]);
    }

    private function myFirstSchool()
    {
        $schoolIds = SchoolStaff::where('user_id', Auth::id())->pluck('school_id');

        return \App\Models\School::whereIn('id', $schoolIds)->first();
    }

    public function approveParent(int $id): void
    {
        $this->decide(ParentSchoolRelationship::findOrFail($id), 'parent', 'verified');
    }

    public function rejectParent(int $id): void
    {
        $this->decide(ParentSchoolRelationship::findOrFail($id), 'parent', 'rejected');
    }

    public function approveStudent(int $id): void
    {
        $this->decide(StudentSchoolRelationship::findOrFail($id), 'student', 'verified');
    }

    public function rejectStudent(int $id): void
    {
        $this->decide(StudentSchoolRelationship::findOrFail($id), 'student', 'rejected');
    }

    public function approveTeacher(int $id): void
    {
        $this->decide(TeacherSchoolRelationship::findOrFail($id), 'teacher', 'verified');
    }

    public function rejectTeacher(int $id): void
    {
        $this->decide(TeacherSchoolRelationship::findOrFail($id), 'teacher', 'rejected');
    }

    /**
     * The one path all six approve/reject buttons go through, so the
     * jurisdiction check, the attribution, the audit entry and the
     * notification can't drift apart between roles — which is how the
     * rejections ended up with no record of who made them.
     */
    private function decide(
        ParentSchoolRelationship|StudentSchoolRelationship|TeacherSchoolRelationship $relationship,
        string $role,
        string $status
    ): void {
        $relationship = $this->authorizeRelationship($relationship);
        $relationship->recordDecision($status, Auth::user());

        AuditLog::record('relationship.'.($status === 'verified' ? 'approved' : 'rejected'), Auth::id(), $relationship, [
            'role' => $role,
            'school_id' => $relationship->school_id,
            'subject_user_id' => $relationship->user_id,
        ]);

        if ($status === 'verified') {
            $relationship->user?->notify(new RelationshipApproved($relationship->school, $role));
        }
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

        // And never your own request. A member of staff whose own child
        // attends the school they work at files this link like any other
        // parent, but approving it themselves is the self-grant that unlocks
        // everything else: verified standing here is what lets someone file
        // anonymous complaints, feedback, teacher ratings and safeguarding
        // reports about this school. Every dual-role refusal elsewhere in the
        // platform (ComplaintPolicy's respond/review, the appeal screen's
        // canReview, SafeguardingService::canView) assumes that standing was
        // granted by somebody else. A colleague decides it instead.
        abort_if($relationship->user_id === Auth::id(), 403, 'Another member of staff has to decide your own request to link this school.');

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
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">School Dashboard{{ $school ? ' — '.$school->name : '' }}</h2>
    </x-slot>

    <div class="py-8 max-w-5xl mx-auto sm:px-6 lg:px-8 space-y-6">
        @if (! $school)
            <div class="bg-white rounded-lg shadow p-6 text-gray-500">No school is linked to your account yet.</div>
        @else
            @if ($school->recognition_status !== 'verified')
                <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
                    This school is <strong>{{ str_replace('_', ' ', $school->recognition_status) }}</strong> — it won't
                    appear in public search or ratings until a District/State Officer verifies it. You can still
                    manage its profile and respond to complaints in the meantime.
                </div>
            @endif

            <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div class="bg-white rounded-lg shadow p-4">
                    <div class="text-2xl font-bold text-indigo-600">{{ $school->latestQualityScore?->score ?? '—' }}</div>
                    <div class="text-xs text-gray-500">School Quality Index</div>
                </div>
                <div class="bg-white rounded-lg shadow p-4">
                    <div class="text-2xl font-bold text-gray-900">{{ $stats['open'] }}</div>
                    <div class="text-xs text-gray-500">Open Complaints</div>
                </div>
                <div class="bg-white rounded-lg shadow p-4">
                    <div class="text-2xl font-bold text-red-600">{{ $stats['overdue'] }}</div>
                    <div class="text-xs text-gray-500">Overdue (&gt;7 days, no response)</div>
                </div>
                <div class="bg-white rounded-lg shadow p-4">
                    <div class="text-2xl font-bold text-green-600">{{ $stats['resolved'] }}</div>
                    <div class="text-xs text-gray-500">Resolved</div>
                </div>
            </div>

            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-3">Manage this school</h3>
                <div class="flex flex-wrap gap-3">
                    <a href="{{ route('fees.manage', $school) }}" wire:navigate
                        class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Fees &amp; charges</a>
                    <a href="{{ route('facilities.manage', $school) }}" wire:navigate
                        class="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">Facilities</a>
                    <a href="{{ route('courses.manage', $school) }}" wire:navigate
                        class="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">Courses</a>
                    <a href="{{ route('exams.manage', $school) }}" wire:navigate
                        class="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">Exams &amp; coaching</a>
                    <a href="{{ route('academic-records.index', $school) }}" wire:navigate
                        class="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">Academic records</a>
                    <a href="{{ route('improvement.show', $school) }}" wire:navigate
                        class="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">Improvement over time</a>
                    <a href="{{ route('schools.show', $school) }}" wire:navigate
                        class="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">View public profile</a>
                </div>
            </div>

            @php $pendingTotal = $pendingParents->count() + $pendingStudents->count() + $pendingTeachers->count(); @endphp
            @if ($pendingTotal > 0)
                <div class="bg-white rounded-lg shadow p-6">
                    <h3 class="font-semibold text-gray-900 mb-4">Pending Verifications ({{ $pendingTotal }})</h3>

                    @foreach ($pendingParents as $rel)
                        <div class="flex justify-between items-center py-2 border-b text-sm">
                            <span>{{ $rel->user->name }} — Parent</span>
                            @if ($rel->user_id === auth()->id())
                                {{-- Your own request: a colleague decides it, so the buttons would only 403. --}}
                                <span class="text-xs text-gray-500">Your own request — another member of staff has to decide it</span>
                            @else
                                <span class="flex gap-2">
                                    <button wire:click="approveParent({{ $rel->id }})" class="text-xs px-2 py-1 bg-green-600 text-white rounded">Approve</button>
                                    <button wire:click="rejectParent({{ $rel->id }})" class="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded">Reject</button>
                                </span>
                            @endif
                        </div>
                    @endforeach

                    @foreach ($pendingStudents as $rel)
                        <div class="flex justify-between items-center py-2 border-b text-sm">
                            <span>{{ $rel->user->name }} — Student (Class {{ $rel->class_grade }})</span>
                            @if ($rel->user_id === auth()->id())
                                {{-- Your own request: a colleague decides it, so the buttons would only 403. --}}
                                <span class="text-xs text-gray-500">Your own request — another member of staff has to decide it</span>
                            @else
                                <span class="flex gap-2">
                                    <button wire:click="approveStudent({{ $rel->id }})" class="text-xs px-2 py-1 bg-green-600 text-white rounded">Approve</button>
                                    <button wire:click="rejectStudent({{ $rel->id }})" class="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded">Reject</button>
                                </span>
                            @endif
                        </div>
                    @endforeach

                    @foreach ($pendingTeachers as $rel)
                        <div class="flex justify-between items-center py-2 border-b text-sm">
                            <span>{{ $rel->user->name }} — Teacher</span>
                            @if ($rel->user_id === auth()->id())
                                {{-- Your own request: a colleague decides it, so the buttons would only 403. --}}
                                <span class="text-xs text-gray-500">Your own request — another member of staff has to decide it</span>
                            @else
                                <span class="flex gap-2">
                                    <button wire:click="approveTeacher({{ $rel->id }})" class="text-xs px-2 py-1 bg-green-600 text-white rounded">Approve</button>
                                    <button wire:click="rejectTeacher({{ $rel->id }})" class="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded">Reject</button>
                                </span>
                            @endif
                        </div>
                    @endforeach
                </div>
            @endif

            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-1">Invite a Member</h3>
                <p class="text-xs text-gray-500 mb-4">School-initiated invites are trusted immediately — no separate approval step once accepted.</p>

                @if ($inviteLink)
                    <div class="bg-green-50 rounded p-3 mb-4 text-sm">
                        <p class="text-green-800 mb-1">Invitation created. This test environment doesn't send real email — share this link directly:</p>
                        <p class="font-mono text-xs break-all text-green-900">{{ $inviteLink }}</p>
                    </div>
                @endif

                <form wire:submit="sendInvite" class="flex flex-wrap gap-3 items-end">
                    <div class="flex-1 min-w-[180px]">
                        <x-input-label for="inviteEmail" value="Email" />
                        <x-text-input wire:model="inviteEmail" id="inviteEmail" type="email" class="mt-1 w-full" />
                        <x-input-error :messages="$errors->get('inviteEmail')" class="mt-2" />
                    </div>
                    <div>
                        <x-input-label for="inviteRole" value="Role" />
                        <select wire:model="inviteRole" id="inviteRole" class="border-gray-300 rounded-md shadow-sm mt-1">
                            <option value="parent">Parent</option>
                            <option value="student">Student</option>
                            <option value="teacher">Teacher</option>
                        </select>
                    </div>
                    <div class="flex-1 min-w-[160px]">
                        <x-input-label for="inviteStudentName" value="For student (optional)" />
                        <x-text-input wire:model="inviteStudentName" id="inviteStudentName" class="mt-1 w-full" placeholder="Child's name, if inviting a parent" />
                    </div>
                    <x-primary-button>Send Invite</x-primary-button>
                </form>

                @if ($sentInvitations->isNotEmpty())
                    <div class="mt-4 border-t pt-4">
                        @foreach ($sentInvitations as $invite)
                            <div class="flex justify-between items-center py-1.5 text-sm">
                                <span>{{ $invite->email }} — {{ ucfirst($invite->role) }}{{ $invite->student_name ? ' ('.$invite->student_name.')' : '' }}</span>
                                <span class="flex items-center gap-2">
                                    <span class="text-xs px-2 py-0.5 rounded
                                        {{ $invite->status === 'accepted' ? 'bg-green-100 text-green-700' : ($invite->status === 'revoked' ? 'bg-gray-100 text-gray-500' : 'bg-yellow-100 text-yellow-700') }}">
                                        {{ ucfirst($invite->status) }}
                                    </span>
                                    @if ($invite->status === 'pending')
                                        <button wire:click="revokeInvite({{ $invite->id }})" class="text-xs text-red-600 hover:underline">Revoke</button>
                                    @endif
                                </span>
                            </div>
                        @endforeach
                    </div>
                @endif
            </div>

            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-4">Complaints</h3>
                @forelse ($complaints as $complaint)
                    <a href="{{ route('complaints.show', $complaint) }}" wire:navigate class="flex justify-between py-2 border-b last:border-0 text-sm hover:bg-gray-50 -mx-2 px-2 rounded">
                        <span>{{ $complaint->complaint_number }} — {{ $complaint->category->name }}</span>
                        <span class="text-gray-400">{{ str_replace('_', ' ', $complaint->status) }}</span>
                    </a>
                @empty
                    <p class="text-sm text-gray-400">No complaints yet.</p>
                @endforelse
            </div>
        @endif
    </div>
</div>
