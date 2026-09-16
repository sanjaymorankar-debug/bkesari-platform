<?php

use App\Models\CounsellingSession;
use App\Models\HealthFollowup;
use App\Models\PhysicalHealthRecord;
use App\Models\User;
use App\Services\HealthAccessService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec sections 18-21 — a child's health record, seen by whoever section 20
 * says may see it.
 *
 * What each viewer gets differs, and deliberately so: a counsellor's raw
 * session notes never render here for anyone, because this page is reachable
 * by guardians. The counselling area shows the counsellor's own written
 * summary or nothing at all.
 */
new #[Layout('layouts.app')] class extends Component
{
    public User $student;

    public function mount(User $student): void
    {
        $this->student = $student;

        // Authorisation and the audit entry are bound together in the service
        // so neither can happen without the other.
        app(HealthAccessService::class)->authoriseAndLogView(
            Auth::user(),
            $student->id,
            HealthAccessService::PURPOSE_PHYSICAL,
            'physical_health',
        );
    }

    public function with(): array
    {
        $viewer = Auth::user();
        $service = app(HealthAccessService::class);

        $canSeeWellbeing = $service->canView($viewer, $this->student->id, HealthAccessService::PURPOSE_WELLBEING);

        $sessions = collect();

        if ($canSeeWellbeing) {
            $sessions = CounsellingSession::where('student_user_id', $this->student->id)
                ->orderByDesc('session_date')
                ->get()
                // Guardian-safe projection. Raw notes never reach the view.
                ->map(fn (CounsellingSession $s): array => $s->guardianView());

            $service->log($viewer, $this->student->id, 'counselling_session', 'viewed');
        }

        return [
            'records' => PhysicalHealthRecord::where('student_user_id', $this->student->id)
                ->orderByDesc('examination_date')->get(),
            'followups' => HealthFollowup::where('student_user_id', $this->student->id)
                ->orderByDesc('identified_on')->get(),
            'sessions' => $sessions,
            'canSeeWellbeing' => $canSeeWellbeing,
            'isNurse' => $viewer->hasRole('school_nurse'),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Health record — {{ $student->name }}</h2>
    </x-slot>

    <div class="py-8 max-w-4xl mx-auto sm:px-6 lg:px-8 space-y-6">

        <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-4 text-sm text-indigo-900">
            This record is private. It is never shown on the school's public profile and never counts towards any
            rating. Every time it is opened, that is recorded.
        </div>

        @if ($isNurse)
            <a href="{{ route('health.record', $student) }}" wire:navigate
                class="inline-block px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">
                Record a screening
            </a>
        @endif

        {{-- Open follow-ups first: a finding nobody acted on is the thing most
             worth surfacing, and the reason section 21 asks for a lifecycle. --}}
        @if ($followups->where('status', '!=', 'closed')->where('status', '!=', 'completed')->isNotEmpty())
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-3">Open follow-ups</h3>
                @foreach ($followups->filter(fn ($f) => $f->isOpen()) as $followup)
                    <div class="py-2 border-b last:border-0">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <span class="text-sm font-medium text-gray-900">{{ \App\Models\HealthFollowup::AREAS[$followup->area] }}</span>
                                <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{{ $followup->statusLabel() }}</span>
                                @if ($followup->isOverdue())
                                    <span class="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800">Overdue</span>
                                @endif
                            </div>
                            <span class="text-xs text-gray-400">
                                identified {{ $followup->identified_on->format('j M Y') }}
                                @if ($followup->due_on) &middot; due {{ $followup->due_on->format('j M Y') }} @endif
                            </span>
                        </div>
                        <p class="text-sm text-gray-600 mt-1">{{ $followup->finding }}</p>
                        @if ($followup->recommended_action)
                            <p class="text-sm text-gray-500">What to do: {{ $followup->recommended_action }}</p>
                        @endif
                    </div>
                @endforeach
            </div>
        @endif

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-1">Screenings</h3>
            <p class="text-xs text-gray-500 mb-4">Every examination is kept. Nothing replaces an earlier record.</p>

            @forelse ($records as $record)
                <div class="py-3 border-b last:border-0">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <span class="text-sm font-medium text-gray-900">
                            {{ \App\Models\PhysicalHealthRecord::EXAMINATION_TYPES[$record->examination_type] }}
                        </span>
                        <span class="text-xs text-gray-400">
                            {{ $record->examination_date->format('j M Y') }} &middot; {{ $record->academic_year }}
                        </span>
                    </div>

                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-sm">
                        @if ($record->height_cm)
                            <div><span class="text-gray-500 text-xs block">Height</span>{{ $record->height_cm }} cm</div>
                        @endif
                        @if ($record->weight_kg)
                            <div><span class="text-gray-500 text-xs block">Weight</span>{{ $record->weight_kg }} kg</div>
                        @endif
                        @if ($record->calculatedBmi())
                            <div><span class="text-gray-500 text-xs block">BMI</span>{{ $record->calculatedBmi() }}</div>
                        @endif
                        @if ($record->vision_left || $record->vision_right)
                            <div>
                                <span class="text-gray-500 text-xs block">Vision</span>
                                {{ $record->vision_left ?? '—' }} / {{ $record->vision_right ?? '—' }}
                            </div>
                        @endif
                        @if ($record->hearing)
                            <div><span class="text-gray-500 text-xs block">Hearing</span>{{ str_replace('_', ' ', $record->hearing) }}</div>
                        @endif
                        @if ($record->dental)
                            <div><span class="text-gray-500 text-xs block">Dental</span>{{ str_replace('_', ' ', $record->dental) }}</div>
                        @endif
                    </div>

                    @if ($record->health_concerns)
                        <p class="text-sm text-gray-700 mt-2"><span class="text-gray-500">Noted:</span> {{ $record->health_concerns }}</p>
                    @endif
                    @if ($record->recommendations)
                        <p class="text-sm text-gray-700"><span class="text-gray-500">Recommended:</span> {{ $record->recommendations }}</p>
                    @endif

                    <p class="text-xs text-gray-400 mt-1">
                        Recorded by {{ $record->recordedBy?->name }}
                        @if ($record->recorded_by_designation) ({{ $record->recorded_by_designation }}) @endif
                        @if ($record->next_due_date) &middot; next due {{ $record->next_due_date->format('M Y') }} @endif
                    </p>
                </div>
            @empty
                <p class="text-sm text-gray-400">No screenings recorded yet.</p>
            @endforelse
        </div>

        @if ($canSeeWellbeing)
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-1">Counselling</h3>
                <p class="text-xs text-gray-500 mb-4">
                    You see what the counsellor has chosen to share. Their own session notes stay with them —
                    that confidentiality is what lets a child speak freely.
                </p>

                @forelse ($sessions as $session)
                    <div class="py-3 border-b last:border-0">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <span class="text-sm font-medium text-gray-900">{{ $session['session_type'] }}</span>
                            <span class="text-xs text-gray-400">{{ $session['session_date']?->format('j M Y') }}</span>
                        </div>
                        @if ($session['has_summary'])
                            <p class="text-sm text-gray-700 mt-1">{{ $session['summary'] }}</p>
                        @else
                            <p class="text-sm text-gray-400 mt-1">The counsellor hasn't written a summary for this session yet.</p>
                        @endif
                        @if ($session['support_plan'])
                            <p class="text-sm text-gray-600 mt-1"><span class="text-gray-500">Support plan:</span> {{ $session['support_plan'] }}</p>
                        @endif
                        @if ($session['referred_externally'])
                            <p class="text-xs text-gray-500 mt-1">Referred to an external service.</p>
                        @endif
                    </div>
                @empty
                    <p class="text-sm text-gray-400">No counselling sessions recorded.</p>
                @endforelse
            </div>
        @endif
    </div>
</div>
