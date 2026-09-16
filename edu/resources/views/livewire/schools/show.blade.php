<?php

use App\Models\CoachingProgramme;
use App\Models\Course;
use App\Models\CourseRating;
use App\Models\ExternalExam;
use App\Models\Fee;
use App\Models\FeeRevision;
use App\Models\ParentSchoolRelationship;
use App\Models\School;
use App\Models\SchoolReply;
use App\Models\StudentSchoolRelationship;
use App\Services\AnnualCostCalculator;
use App\Services\ClaimedVsExperiencedService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    public School $school;

    public function mount(School $school): void
    {
        $this->school = $school->load(['profile', 'state', 'district', 'latestQualityScore']);
    }

    private function currentAcademicYear(): string
    {
        $now = now();
        $startYear = $now->month >= 4 ? $now->year : $now->year - 1;

        return $startYear.'-'.substr((string) ($startYear + 1), 2);
    }

    public function with(): array
    {
        $recentComplaints = $this->school->complaints()
            ->select('id', 'complaint_category_id', 'status', 'created_at')
            ->with('category:id,name')
            ->latest()
            ->limit(5)
            ->get();

        $verifiedTeachers = $this->school->verifiedTeachers()->get(['id', 'name']);

        $user = Auth::user();
        $isLinkable = $user && $user->hasAnyRole(['parent', 'student']);
        $linkStatus = null;

        if ($isLinkable) {
            $relation = $user->hasRole('parent')
                ? ParentSchoolRelationship::where('user_id', $user->id)->where('school_id', $this->school->id)->first()
                : StudentSchoolRelationship::where('user_id', $user->id)->where('school_id', $this->school->id)->first();

            $linkStatus = $relation?->status;
        }

        // Fees for the most recent year the school has published. Older years
        // stay in the table and stay queryable — this page just leads with the
        // current one.
        $latestFeeYear = Fee::where('school_id', $this->school->id)->max('academic_year');

        $fees = $latestFeeYear
            ? Fee::where('school_id', $this->school->id)->where('academic_year', $latestFeeYear)->get()
            : collect();

        $calculator = app(AnnualCostCalculator::class);

        $coaching = CoachingProgramme::where('school_id', $this->school->id)
            ->where('academic_year', $this->currentAcademicYear())
            ->orderBy('programme_name')
            ->get();

        $courses = Course::where('school_id', $this->school->id)
            ->where('academic_year', $this->currentAcademicYear())
            ->orderBy('name')
            ->get();

        $courseRatings = CourseRating::where('school_id', $this->school->id)
            ->where('academic_year', $this->currentAcademicYear())
            ->get()
            ->groupBy('course_id');

        return [
            'recentComplaints' => $recentComplaints,
            'verifiedTeachers' => $verifiedTeachers,
            'isLinkable' => $isLinkable,
            'canSubmit' => $linkStatus === 'verified',
            'linkStatus' => $linkStatus,
            'feeYear' => $latestFeeYear,
            'feeSummary' => $calculator->summarise($fees),
            'feeBreakdown' => $calculator->breakdownByCategory($fees),
            'feeIncreases' => FeeRevision::where('school_id', $this->school->id)
                ->whereColumn('new_amount', '>', 'previous_amount')
                ->latest('changed_at')->limit(5)->with('fee:id,label')->get(),
            'facilityComparison' => app(ClaimedVsExperiencedService::class)
                ->compareSchool($this->school->id, $this->currentAcademicYear()),
            'facilityYear' => $this->currentAcademicYear(),
            // Spec section 29 — shown beside the gap it answers, never instead
            // of it. Keyed by facility so the view can pair them up.
            'facilityReplies' => SchoolReply::where('school_id', $this->school->id)
                ->where('context_type', 'facility_discrepancy')
                ->where('academic_year', $this->currentAcademicYear())
                ->latest()
                ->get()
                ->groupBy('context_key'),
            'exams' => ExternalExam::where('school_id', $this->school->id)
                ->where('academic_year', $this->currentAcademicYear())->orderBy('exam_name')->get(),
            'coaching' => $coaching,
            // Spec section 10 — compulsory costs billed outside the published
            // fee register. Stated as a factual gap between two things the
            // school itself recorded, never as an allegation.
            'unbundledMandatory' => $coaching->filter(fn (CoachingProgramme $c): bool => $c->isUnbundledMandatoryCost()),
            'courses' => $courses,
            // Per-dimension averages per course, each carrying its own
            // response count (spec section 12).
            'courseAverages' => $courses->mapWithKeys(fn (Course $course): array => [
                $course->id => CourseRating::averages($courseRatings->get($course->id, collect())),
            ]),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">{{ $school->name }}</h2>
    </x-slot>

    <div class="py-8 max-w-5xl mx-auto sm:px-6 lg:px-8 space-y-6">
        <div class="bg-white rounded-lg shadow p-6">
            <div class="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p class="text-sm text-gray-500">{{ $school->address }}, {{ $school->city }}, {{ $school->district->name }}, {{ $school->state->name }} - {{ $school->pincode }}</p>
                    <p class="text-sm text-gray-500 mt-1">Board: {{ $school->board }} &middot; Management: {{ ucfirst($school->management_type) }} &middot; Classes: {{ $school->classes_from }} - {{ $school->classes_to }}</p>
                    <p class="text-sm mt-1 flex flex-wrap items-center gap-2">
                        <span class="inline-block px-2 py-0.5 rounded text-xs font-medium
                            {{ $school->recognition_status === 'verified' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800' }}">
                            {{ ucfirst(str_replace('_', ' ', $school->recognition_status)) }}
                        </span>

                        {{-- Spec section 8: this badge appears only on an actual
                             confirmation against government data. A school that has
                             merely typed in a code gets the "not yet confirmed" state,
                             never the badge. --}}
                        @if ($school->isUdiseVerified())
                            <span class="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                UDISE Verified &middot; {{ $school->udise_code }}
                            </span>
                        @elseif ($school->udise_code)
                            <span class="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600"
                                title="The school provided this code. It has not yet been confirmed against government data.">
                                UDISE {{ $school->udise_code }} — not yet confirmed
                            </span>
                        @else
                            <span class="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                                No UDISE code on record
                            </span>
                        @endif
                    </p>
                </div>
                <div class="text-right">
                    @if ($school->latestQualityScore)
                        <div class="text-3xl font-bold text-indigo-600">{{ $school->latestQualityScore->score }}</div>
                        <div class="text-xs text-gray-400">School Quality Index &middot; {{ str_replace('_', ' ', $school->latestQualityScore->confidence) }} confidence</div>
                    @else
                        <div class="text-sm text-gray-400">Insufficient data for SQI</div>
                    @endif
                </div>
            </div>

            @if ($canSubmit)
                <div class="mt-4 flex gap-3">
                    <a href="{{ route('complaints.create', ['school' => $school->id]) }}" wire:navigate
                        class="inline-flex items-center px-4 py-2 bg-red-600 text-white text-sm rounded-md hover:bg-red-700">Report a Problem</a>
                    {{-- Spec section 25: a separate, unmissable route. A concern
                         about a child's safety must not have to travel through
                         the general complaint queue to be seen. --}}
                    <a href="{{ route('improvement.show', $school) }}" wire:navigate
                        class="inline-flex items-center px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-md hover:bg-gray-50">Improvement over time</a>
                    <a href="{{ route('safeguarding.report', $school) }}" wire:navigate
                        class="inline-flex items-center px-4 py-2 border-2 border-red-600 text-red-700 text-sm rounded-md hover:bg-red-50">Report a concern about a child's safety</a>
                    <a href="{{ route('feedback.create', $school) }}" wire:navigate
                        class="inline-flex items-center px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">Rate this School</a>
                </div>
            @elseif ($isLinkable && $linkStatus === 'pending')
                <p class="mt-4 text-sm text-yellow-700">Your link to this school is awaiting approval from the school admin.</p>
            @elseif ($isLinkable && $linkStatus === null)
                <a href="{{ route('onboarding') }}?school={{ $school->id }}" wire:navigate
                    class="mt-4 inline-flex items-center px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">Link this school to my account</a>
            @endif
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <div class="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                <h3 class="font-semibold text-gray-900">What it costs</h3>
                @if ($feeYear)
                    <span class="text-xs text-gray-400">{{ $feeYear }} &middot; school-reported</span>
                @endif
            </div>

            @if ($feeSummary['has_data'])
                <p class="text-xs text-gray-500 mb-4">
                    Estimated from the {{ $feeSummary['fee_count'] }} charges this school has published — not a
                    quotation, and not independently verified. One-time joining charges are shown separately so
                    the first year isn't confused with every year after it.
                </p>

                <div class="grid sm:grid-cols-2 gap-3 mb-4">
                    <div class="bg-indigo-50 rounded p-4">
                        <div class="text-xs text-indigo-700">First year, including one-time charges</div>
                        <div class="text-2xl font-bold text-indigo-900">₹{{ number_format($feeSummary['first_year_total']) }}</div>
                        @if ($feeSummary['optional_recurring'] > 0 || $feeSummary['optional_one_time'] > 0)
                            <div class="text-xs text-indigo-700 mt-1">
                                Includes ₹{{ number_format($feeSummary['optional_recurring'] + $feeSummary['optional_one_time']) }} optional
                            </div>
                        @endif
                    </div>
                    <div class="bg-gray-50 rounded p-4">
                        <div class="text-xs text-gray-600">Every year after that</div>
                        <div class="text-2xl font-bold text-gray-900">₹{{ number_format($feeSummary['continuing_year_total']) }}</div>
                        <div class="text-xs text-gray-500 mt-1">
                            ₹{{ number_format($feeSummary['mandatory_recurring']) }} mandatory
                        </div>
                    </div>
                </div>

                <h4 class="text-sm font-medium text-gray-700 mb-2">Where it goes</h4>
                <div class="space-y-1">
                    @foreach ($feeBreakdown as $row)
                        <div class="flex items-center justify-between text-sm py-1 border-b last:border-0">
                            <span class="text-gray-700">
                                {{ $row['label'] }}
                                @unless ($row['mandatory'])
                                    <span class="text-xs text-gray-400">(optional)</span>
                                @endunless
                            </span>
                            <span class="text-gray-900">₹{{ number_format($row['annual']) }}</span>
                        </div>
                    @endforeach
                </div>

                @if ($feeIncreases->isNotEmpty())
                    <div class="mt-4 pt-4 border-t">
                        <h4 class="text-sm font-medium text-gray-700 mb-2">Recent increases</h4>
                        @foreach ($feeIncreases as $increase)
                            <div class="flex flex-wrap justify-between gap-2 text-sm py-1">
                                <span class="text-gray-700">{{ $increase->fee?->label ?? 'A charge' }}</span>
                                <span class="text-gray-600">
                                    ₹{{ number_format((float) $increase->previous_amount) }} →
                                    ₹{{ number_format((float) $increase->new_amount) }}
                                    <span class="text-xs text-gray-400">{{ $increase->changed_at->format('M Y') }}</span>
                                </span>
                            </div>
                        @endforeach
                    </div>
                @endif
            @else
                <p class="text-sm text-gray-400">
                    This school hasn't published its fees here yet. An empty fee section is not evidence of low
                    fees — it means nothing has been reported.
                </p>
            @endif

            {{-- Spec section 10 feeding back into section 9. Deliberately outside
                 the has-data branch above: a school that publishes no fees at all
                 but charges compulsory coaching is the case where an unrecorded
                 cost matters most, and hiding this panel there would be exactly
                 backwards. --}}
            @if ($unbundledMandatory->isNotEmpty())
                <div class="mt-4 bg-amber-50 border border-amber-200 rounded p-4">
                    <div class="text-sm font-medium text-amber-900 mb-1">
                        Not included in the figures above
                    </div>
                    <p class="text-xs text-amber-900 mb-2">
                        The school records these as compulsory but bills them separately from school fees, so
                        they are not part of {{ $feeSummary['has_data'] ? 'the totals above' : 'any published fee figure' }}.
                    </p>
                    @foreach ($unbundledMandatory as $programme)
                        <div class="flex justify-between text-sm text-amber-900">
                            <span>{{ $programme->programme_name }}</span>
                            <span>₹{{ number_format((float) $programme->fee) }}</span>
                        </div>
                    @endforeach
                    <div class="flex justify-between text-sm font-semibold text-amber-900 border-t border-amber-200 mt-2 pt-2">
                        <span>Additional compulsory cost</span>
                        <span>₹{{ number_format($unbundledMandatory->sum(fn ($p) => (float) $p->fee)) }}</span>
                    </div>
                </div>
            @endif
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <div class="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                <h3 class="font-semibold text-gray-900">What it offers, and what families report</h3>
                <span class="text-xs text-gray-400">{{ $facilityYear }}</span>
            </div>

            @if (count($facilityComparison) > 0)
                <p class="text-xs text-gray-500 mb-4">
                    The left column is what the school lists. The right is what verified parents and students
                    report experiencing. A gap is a <em>reported difference</em>, not a finding against the
                    school — a facility can exist and still be hard to access, and schools can respond.
                </p>

                <div class="space-y-2">
                    @foreach ($facilityComparison as $row)
                        @php $replies = $facilityReplies->get($row['facility_key'], collect()); @endphp
                        <div class="py-2 border-b last:border-0">
                        <div class="flex flex-wrap items-center justify-between gap-3">
                            <div class="flex-1 min-w-48">
                                <span class="text-sm text-gray-800">{{ $row['label'] }}</span>
                                <span class="text-xs text-gray-400">&middot; {{ $row['group'] }}</span>
                                @if ($row['verification_status'] === 'verified')
                                    <span class="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-800">evidence checked</span>
                                @endif
                            </div>
                            <div class="text-right">
                                <span class="text-xs px-2 py-0.5 rounded-full
                                    @if ($row['status'] === 'consistent') bg-green-100 text-green-800
                                    @elseif ($row['status'] === 'partially_consistent') bg-yellow-100 text-yellow-800
                                    @elseif ($row['status'] === 'significant_discrepancy') bg-amber-100 text-amber-900
                                    @else bg-gray-100 text-gray-600 @endif">
                                    {{ $row['status_label'] }}
                                </span>
                                <div class="text-xs text-gray-400 mt-0.5">
                                    @if ($row['report_count'] > 0)
                                        {{ $row['report_count'] }} {{ Str::plural('report', $row['report_count']) }}
                                        {{-- The confidence tier is only meaningful once a status has
                                             actually been assigned; below the threshold the status
                                             already says there isn't enough to go on. --}}
                                        @if ($row['confidence'] !== 'insufficient')
                                            &middot; {{ $row['confidence'] }} confidence
                                        @endif
                                    @else
                                        awaiting reports
                                    @endif
                                </div>
                            </div>
                        </div>

                        {{-- Spec section 29: both sides. The school's answer
                             sits beside the report, never in place of it. --}}
                        @foreach ($replies as $reply)
                            <div class="mt-2 ml-4 pl-3 border-l-2 border-indigo-200">
                                <div class="text-xs font-medium text-indigo-800">Response from the school</div>
                                <p class="text-sm text-gray-700">{{ $reply->body }}</p>
                                <div class="text-xs text-gray-400">{{ $reply->created_at->format('j M Y') }}</div>
                            </div>
                        @endforeach
                        </div>
                    @endforeach
                </div>

                @if ($canSubmit)
                    <a href="{{ route('facilities.rate', $school) }}" wire:navigate
                        class="inline-block mt-4 px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">
                        Report on a facility
                    </a>
                @endif
            @else
                <p class="text-sm text-gray-400">
                    This school hasn't listed its facilities for {{ $facilityYear }} yet. Nothing is claimed here,
                    so there is nothing to compare against.
                </p>
            @endif
        </div>

        @if ($courses->isNotEmpty())
            <div class="bg-white rounded-lg shadow p-6">
                <div class="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                    <h3 class="font-semibold text-gray-900">Courses</h3>
                    <span class="text-xs text-gray-400">{{ $facilityYear }}</span>
                </div>
                <p class="text-xs text-gray-500 mb-4">
                    Rated by verified students and parents. Each figure shows how many people answered that
                    question — parents are only asked about things they're in a position to see, so some
                    dimensions have fewer responses than others.
                </p>

                <div class="space-y-4">
                    @foreach ($courses as $course)
                        @php $rated = collect($courseAverages[$course->id])->where('responses', '>', 0); @endphp
                        <div class="py-2 border-b last:border-0">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="text-sm font-medium text-gray-900">{{ $course->name }}</span>
                                <span class="text-xs text-gray-400">{{ $course->typeLabel() }}</span>
                                @if ($course->applicable_classes)
                                    <span class="text-xs text-gray-400">&middot; classes {{ $course->applicable_classes }}</span>
                                @endif
                            </div>

                            @if ($rated->isNotEmpty())
                                <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                                    @foreach ($rated as $dimension)
                                        <div class="flex items-baseline justify-between text-sm bg-gray-50 rounded px-2 py-1">
                                            <span class="text-gray-600 text-xs">{{ $dimension['label'] }}</span>
                                            <span class="text-gray-900">
                                                {{ $dimension['average'] }}<span class="text-xs text-gray-400">/5</span>
                                                <span class="text-xs text-gray-400">({{ $dimension['responses'] }})</span>
                                            </span>
                                        </div>
                                    @endforeach
                                </div>
                            @else
                                <p class="text-xs text-gray-400 mt-1">No ratings yet.</p>
                            @endif
                        </div>
                    @endforeach
                </div>

                @if ($canSubmit)
                    <a href="{{ route('courses.rate', $school) }}" wire:navigate
                        class="inline-block mt-4 px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">
                        Rate a course
                    </a>
                @endif
            </div>
        @endif

        @if ($exams->isNotEmpty() || $coaching->isNotEmpty())
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-1">Exams &amp; coaching</h3>
                <p class="text-xs text-gray-500 mb-4">School-reported for {{ $facilityYear }}.</p>

                @if ($exams->isNotEmpty())
                    <h4 class="text-sm font-medium text-gray-700 mb-2">External exams</h4>
                    <div class="space-y-1 mb-4">
                        @foreach ($exams as $exam)
                            <div class="flex flex-wrap items-center justify-between gap-2 py-1 border-b last:border-0">
                                <div>
                                    <span class="text-sm text-gray-800">{{ $exam->exam_name }}</span>
                                    <span class="text-xs text-gray-400">&middot; {{ $exam->typeLabel() }}</span>
                                    @if ($exam->is_mandatory)
                                        <span class="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">compulsory</span>
                                    @endif
                                </div>
                                <span class="text-sm text-gray-700">
                                    @if ($exam->totalCost() > 0) ₹{{ number_format($exam->totalCost()) }} @else — @endif
                                </span>
                            </div>
                        @endforeach
                    </div>
                @endif

                @if ($coaching->isNotEmpty())
                    <h4 class="text-sm font-medium text-gray-700 mb-2">Coaching &amp; preparation</h4>
                    <div class="space-y-1">
                        @foreach ($coaching as $programme)
                            <div class="flex flex-wrap items-center justify-between gap-2 py-1 border-b last:border-0">
                                <div>
                                    <span class="text-sm text-gray-800">{{ $programme->programme_name }}</span>
                                    <span class="text-xs text-gray-400">&middot; {{ $programme->typeLabel() }}</span>
                                    @if ($programme->isEffectivelyCompulsory())
                                        <span class="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">
                                            {{ $programme->is_mandatory ? 'compulsory' : 'in school hours' }}
                                        </span>
                                    @endif
                                    @if ($programme->bundled_into_school_fees)
                                        <span class="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-800">in school fees</span>
                                    @endif
                                </div>
                                <span class="text-sm text-gray-700">
                                    @if ($programme->fee) ₹{{ number_format((float) $programme->fee) }} @else — @endif
                                </span>
                            </div>
                        @endforeach
                    </div>
                @endif
            </div>
        @endif

        @if ($school->profile)
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-2">About</h3>
                <p class="text-gray-600 text-sm">{{ $school->profile->about }}</p>

                <div class="grid grid-cols-2 gap-4 mt-4">
                    <div>
                        <h4 class="text-sm font-medium text-gray-700">Facilities</h4>
                        <p class="text-sm text-gray-500">{{ implode(', ', $school->profile->facilities ?? []) }}</p>
                    </div>
                    <div>
                        <h4 class="text-sm font-medium text-gray-700">Sports</h4>
                        <p class="text-sm text-gray-500">{{ implode(', ', $school->profile->sports ?? []) }}</p>
                    </div>
                </div>
            </div>
        @endif

        @if ($canSubmit && $verifiedTeachers->isNotEmpty())
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-2">Rate a Teacher</h3>
                <p class="text-xs text-gray-400 mb-3">Private and anonymous — feeds only that teacher's own effectiveness index.</p>
                <div class="flex flex-wrap gap-2">
                    @foreach ($verifiedTeachers as $teacher)
                        <a href="{{ route('teacher-feedback.create', $teacher) }}" wire:navigate
                            class="text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700">{{ $teacher->name }}</a>
                    @endforeach
                </div>
            </div>
        @endif

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-2">Recent Complaint Trends</h3>
            <p class="text-xs text-gray-400 mb-3">Category and status only — submitter identity is never shown here.</p>
            @forelse ($recentComplaints as $c)
                <div class="flex justify-between py-2 border-b last:border-0 text-sm">
                    <span>{{ $c->category->name }}</span>
                    <span class="text-gray-500">{{ str_replace('_', ' ', $c->status) }}</span>
                </div>
            @empty
                <p class="text-sm text-gray-400">No complaints recorded.</p>
            @endforelse
        </div>
    </div>
</div>
