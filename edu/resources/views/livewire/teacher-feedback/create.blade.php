<?php

use App\Models\FraudFlag;
use App\Models\ParentSchoolRelationship;
use App\Models\Setting;
use App\Models\StudentSchoolRelationship;
use App\Models\TeacherFeedback;
use App\Models\TeacherRatingComponent;
use App\Models\TeacherSchoolRelationship;
use App\Models\User;
use App\Services\AIAssistService;
use App\Services\TeacherEffectivenessIndexService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    public User $teacher;
    public array $scores = [];
    public string $overallComment = '';

    public function mount(User $teacher): void
    {
        abort_unless($teacher->hasRole('teacher'), 404);

        $this->teacher = $teacher;
        foreach (TeacherRatingComponent::where('is_active', true)->get() as $dimension) {
            $this->scores[$dimension->key] = 3;
        }
    }

    /**
     * A parent/student may only rate a teacher who is verified at the same
     * school they themselves are verified at — same trust boundary as
     * complaints/school feedback.
     */
    private function sharedVerifiedSchoolId(): ?int
    {
        $user = Auth::user();
        $teacherSchoolIds = TeacherSchoolRelationship::where('user_id', $this->teacher->id)
            ->where('status', 'verified')->pluck('school_id');

        if ($user->hasRole('parent')) {
            $mySchoolIds = ParentSchoolRelationship::where('user_id', $user->id)
                ->where('status', 'verified')->pluck('school_id');
        } else {
            $mySchoolIds = StudentSchoolRelationship::where('user_id', $user->id)
                ->where('status', 'verified')->pluck('school_id');
        }

        return $teacherSchoolIds->intersect($mySchoolIds)->first();
    }

    public function submit(): void
    {
        $schoolId = $this->sharedVerifiedSchoolId();
        abort_unless($schoolId !== null, 403, 'You can only rate teachers verified at your own school.');

        $role = Auth::user()->hasRole('parent') ? 'parent' : 'student';
        $anonymousRef = Auth::user()->anonymousRefFor(\App\Models\School::findOrFail($schoolId), $role);

        TeacherFeedback::create([
            'teacher_user_id' => $this->teacher->id,
            'school_id' => $schoolId,
            'anonymous_ref' => $anonymousRef,
            'rater_role' => $role,
            'dimension_scores' => $this->scores,
            'overall_comment' => $this->overallComment ?: null,
            'submitted_at' => now(),
        ]);

        app(TeacherEffectivenessIndexService::class)->recalculate($this->teacher);
        $this->flagIfSpike();

        $this->redirect(route('schools.show', $schoolId), navigate: true);
    }

    /**
     * Rule-based coordinated-review check (spec section AE) — advisory only.
     */
    private function flagIfSpike(): void
    {
        $windowMinutes = (int) Setting::get('fraud.window_minutes', 10);
        $threshold = (int) Setting::get('fraud.threshold', 5);

        $timestamps = TeacherFeedback::where('teacher_user_id', $this->teacher->id)
            ->where('submitted_at', '>=', now()->subMinutes($windowMinutes * 3))
            ->pluck('submitted_at');

        $spiked = app(AIAssistService::class)->detectFeedbackSpike($timestamps, $windowMinutes, $threshold);

        if ($spiked && ! FraudFlag::where('subject_type', 'teacher')->where('subject_id', $this->teacher->id)
            ->where('flag_type', 'feedback_spike')->where('status', 'open')->exists()) {
            FraudFlag::create([
                'flag_type' => 'feedback_spike',
                'subject_type' => 'teacher',
                'subject_id' => $this->teacher->id,
                'details' => ['window_minutes' => $windowMinutes, 'threshold' => $threshold, 'detected_at' => now()->toIso8601String()],
                'status' => 'open',
            ]);
        }
    }

    public function with(): array
    {
        return ['components' => TeacherRatingComponent::where('is_active', true)->get()];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Rate {{ $teacher->name }}</h2>
    </x-slot>

    <div class="py-8 max-w-2xl mx-auto sm:px-6 lg:px-8">
        <div class="bg-white rounded-lg shadow p-6">
            <p class="text-sm text-gray-500 mb-6">
                Your rating is anonymous and private — it only feeds this teacher's own Teacher Effectiveness Index,
                which is never shown publicly or to the school (spec section AI).
            </p>

            <form wire:submit="submit" class="space-y-4">
                @foreach ($components as $dimension)
                    <div>
                        <div class="flex justify-between text-sm">
                            <x-input-label :value="$dimension->label" />
                            <span>{{ $scores[$dimension->key] }} / 5</span>
                        </div>
                        <input type="range" min="1" max="5" wire:model="scores.{{ $dimension->key }}" class="w-full" />
                    </div>
                @endforeach

                <div>
                    <x-input-label for="overallComment" value="Comments (optional)" />
                    <textarea wire:model="overallComment" id="overallComment" rows="3" class="border-gray-300 rounded-md shadow-sm mt-1 w-full"></textarea>
                </div>

                <x-primary-button>Submit Rating</x-primary-button>
            </form>
        </div>
    </div>
</div>
