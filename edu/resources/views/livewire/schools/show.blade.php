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

    public function rendering($view): void
    {
        $view->title($this->school->name);
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

<div class="edu-school">
    @php
        // Rupees grouped the Indian way (1,60,180), as Kesari asks.
        $inr = fn ($amount) => '₹'.\Illuminate\Support\Number::format((float) $amount, maxPrecision: 0, locale: 'en_IN');
        $statusTone = fn (string $status) => match ($status) {
            'consistent' => 'k-chip--success',
            'partially_consistent' => 'k-chip--info',
            'significant_discrepancy' => 'k-chip--warning',
            default => '',
        };
    @endphp

    <nav class="k-breadcrumbs" aria-label="{{ __('Breadcrumb') }}">
        <ol>
            <li><a href="{{ route('home') }}" wire:navigate>{{ __('Education') }}</a></li>
            <li><a href="{{ route('schools.index') }}" wire:navigate>{{ __('Schools') }}</a></li>
            <li><span aria-current="page">{{ $school->name }}</span></li>
        </ol>
    </nav>

    <header class="k-card edu-school-head">
        <div class="edu-school-head__main">
            <div class="edu-school-head__title">
                <span class="k-picon k-picon--lg"><x-k-icon name="school" /></span>
                <div class="min-w-0">
                    <h1>{{ $school->name }}</h1>
                    <p class="edu-meta"><x-k-icon name="map-pin" class="k-icon--sm" /> <span>{{ $school->address }}, {{ $school->city }}, {{ $school->district->name }}, {{ $school->state->name }} - {{ $school->pincode }}</span></p>
                </div>
            </div>

            <dl class="edu-facts">
                <div><dt>{{ __('Board') }}</dt><dd>{{ $school->board }}</dd></div>
                <div><dt>{{ __('Management') }}</dt><dd>{{ __(ucfirst($school->management_type)) }}</dd></div>
                <div><dt>{{ __('Classes') }}</dt><dd>{{ $school->classes_from }} – {{ $school->classes_to }}</dd></div>
            </dl>

            <ul class="edu-chips" role="list">
                <li>
                    <span class="k-chip {{ $school->recognition_status === 'verified' ? 'k-chip--success' : 'k-chip--warning' }}">
                        {{ __(ucfirst(str_replace('_', ' ', $school->recognition_status))) }}
                    </span>
                </li>
                {{-- Spec section 8: this badge appears only on an actual
                     confirmation against government data. A school that has
                     merely typed in a code gets the "not yet confirmed" state,
                     never the badge. --}}
                <li>
                    @if ($school->isUdiseVerified())
                        <span class="k-chip k-chip--success">{{ __('UDISE Verified') }} &middot; {{ $school->udise_code }}</span>
                    @elseif ($school->udise_code)
                        <span class="k-chip">UDISE {{ $school->udise_code }} — {{ __('not yet confirmed') }}</span>
                    @else
                        <span class="k-chip">{{ __('No UDISE code on record') }}</span>
                    @endif
                </li>
            </ul>
            @if (! $school->isUdiseVerified() && $school->udise_code)
                <p class="k-hint mt-2 mb-0">{{ __('The school provided this code. It has not yet been confirmed against government data.') }}</p>
            @endif
        </div>

        <div class="edu-score">
            @if ($school->latestQualityScore)
                <p class="edu-score__value">{{ $school->latestQualityScore->score }}</p>
                <p class="edu-score__label">{{ __('School Quality Index') }}</p>
                <p class="edu-score__meta">{{ __(':level confidence', ['level' => str_replace('_', ' ', $school->latestQualityScore->confidence)]) }}</p>
            @else
                <p class="edu-score__label">{{ __('Not enough data for a School Quality Index yet') }}</p>
            @endif
        </div>

        <div class="edu-school-head__actions">
            @if ($canSubmit)
                <a href="{{ route('complaints.create', ['school' => $school->id]) }}" wire:navigate class="k-btn"><x-k-icon name="alert" /> {{ __('Report a problem') }}</a>
                <a href="{{ route('feedback.create', $school) }}" wire:navigate class="k-btn k-btn--secondary">{{ __('Rate this school') }}</a>
            @elseif ($isLinkable && $linkStatus === 'pending')
                <p class="k-banner k-banner--warning mb-0" role="status"><x-k-icon name="pending" /> <span>{{ __('Your link to this school is awaiting approval from the school admin.') }}</span></p>
            @elseif ($isLinkable && $linkStatus === null)
                <a href="{{ route('onboarding') }}?school={{ $school->id }}" wire:navigate class="k-btn"><x-k-icon name="plus" /> {{ __('Link this school to my account') }}</a>
            @endif
            <a href="{{ route('improvement.show', $school) }}" wire:navigate class="k-link-arrow">{{ __('Improvement over time') }} <x-k-icon name="arrow-right" /></a>
        </div>
    </header>

    @if ($canSubmit)
        {{-- Spec section 25: a separate, unmissable route. A concern about a
             child's safety must not have to travel through the general
             complaint queue to be seen. --}}
        <div class="k-banner k-banner--danger edu-callout">
            <x-k-icon name="shield" />
            <p class="flex-1"><strong>{{ __('Worried about a child’s safety?') }}</strong> {{ __('This is handled apart from ordinary complaints, and the school’s administration never sees it.') }}</p>
            <a href="{{ route('safeguarding.report', $school) }}" wire:navigate class="k-btn k-btn--secondary">{{ __('Report a concern about a child’s safety') }}</a>
        </div>
    @endif

    <nav class="edu-toc-nav" aria-label="{{ __('On this page') }}">
        <ul class="edu-toc" role="list">
            <li><a href="#costs">{{ __('What it costs') }}</a></li>
            <li><a href="#facilities">{{ __('Facilities') }}</a></li>
            @if ($courses->isNotEmpty())
                <li><a href="#courses">{{ __('Courses') }}</a></li>
            @endif
            @if ($exams->isNotEmpty() || $coaching->isNotEmpty())
                <li><a href="#exams">{{ __('Exams & coaching') }}</a></li>
            @endif
            @if ($school->profile)
                <li><a href="#about">{{ __('About') }}</a></li>
            @endif
            <li><a href="#complaints">{{ __('Complaint trends') }}</a></li>
        </ul>
    </nav>

    <section id="costs" class="k-card edu-panel" aria-labelledby="costs-title">
        <div class="edu-panel__head">
            <h2 id="costs-title">{{ __('What it costs') }}</h2>
            @if ($feeYear)
                <span class="k-chip k-chip--plain">{{ __(':year · school-reported', ['year' => $feeYear]) }}</span>
            @endif
        </div>

        @if ($feeSummary['has_data'])
            <p class="edu-panel__intro">
                {{ __('Estimated from the :count charges this school has published — not a quotation, and not independently verified. One-time joining charges are shown separately so the first year isn’t confused with every year after it.', ['count' => $feeSummary['fee_count']]) }}
            </p>

            <ul class="k-stats edu-stats" role="list">
                <li class="k-stat edu-stat--tint">
                    <span class="k-stat__value">{{ $inr($feeSummary['first_year_total']) }}</span>
                    <span class="k-stat__label">{{ __('First year, including one-time charges') }}</span>
                    @if ($feeSummary['optional_recurring'] > 0 || $feeSummary['optional_one_time'] > 0)
                        <span class="k-stat__source">{{ __('Includes :amount optional', ['amount' => $inr($feeSummary['optional_recurring'] + $feeSummary['optional_one_time'])]) }}</span>
                    @endif
                </li>
                <li class="k-stat">
                    <span class="k-stat__value">{{ $inr($feeSummary['continuing_year_total']) }}</span>
                    <span class="k-stat__label">{{ __('Every year after that') }}</span>
                    <span class="k-stat__source">{{ __(':amount mandatory', ['amount' => $inr($feeSummary['mandatory_recurring'])]) }}</span>
                </li>
            </ul>

            <h3 class="edu-subhead">{{ __('Where it goes') }}</h3>
            @php
                $largest = max(1, (float) collect($feeBreakdown)->max('annual'));
            @endphp
            <ul class="k-bars" role="list">
                @foreach ($feeBreakdown as $row)
                    <li>
                        <span class="k-bars__label">
                            {{ $row['label'] }}
                            @unless ($row['mandatory'])
                                <span class="k-muted">({{ __('optional') }})</span>
                            @endunless
                        </span>
                        <span class="k-bars__value">{{ $inr($row['annual']) }}</span>
                        <span class="k-bars__track" aria-hidden="true"><span class="k-bars__fill {{ $row['mandatory'] ? '' : 'k-bars__fill--muted' }}" style="--v: {{ round($row['annual'] / $largest * 100) }}"></span></span>
                    </li>
                @endforeach
            </ul>
            <p class="k-hint mt-3 mb-0">{{ __('Bars compare each charge with the largest one. Grey bars are optional.') }}</p>

            @if ($feeIncreases->isNotEmpty())
                <h3 class="edu-subhead">{{ __('Recent increases') }}</h3>
                <ul class="edu-rows" role="list">
                    @foreach ($feeIncreases as $increase)
                        <li>
                            <span class="edu-rows__title">{{ $increase->fee?->label ?? __('A charge') }}</span>
                            <span>
                                {{ $inr($increase->previous_amount) }} → {{ $inr($increase->new_amount) }}
                                <span class="edu-rows__sub">&middot; {{ $increase->changed_at->format('M Y') }}</span>
                            </span>
                        </li>
                    @endforeach
                </ul>
            @endif
        @else
            <p class="edu-none">
                {{ __('This school hasn’t published its fees here yet. An empty fee section is not evidence of low fees — it means nothing has been reported.') }}
            </p>
        @endif

        {{-- Spec section 10 feeding back into section 9. Deliberately outside
             the has-data branch above: a school that publishes no fees at all
             but charges compulsory coaching is the case where an unrecorded
             cost matters most, and hiding this panel there would be exactly
             backwards. --}}
        @if ($unbundledMandatory->isNotEmpty())
            <div class="k-banner k-banner--warning edu-callout edu-callout--stack mt-5 mb-0">
                <p><strong>{{ __('Not included in the figures above') }}</strong></p>
                <p class="text-sm">
                    {{ __('The school records these as compulsory but bills them separately from school fees, so they are not part of :what.', ['what' => $feeSummary['has_data'] ? __('the totals above') : __('any published fee figure')]) }}
                </p>
                <ul class="edu-rows edu-rows--tight" role="list">
                    @foreach ($unbundledMandatory as $programme)
                        <li><span>{{ $programme->programme_name }}</span><span>{{ $inr($programme->fee) }}</span></li>
                    @endforeach
                    <li class="font-bold"><span>{{ __('Additional compulsory cost') }}</span><span>{{ $inr($unbundledMandatory->sum(fn ($p) => (float) $p->fee)) }}</span></li>
                </ul>
            </div>
        @endif
    </section>

    <section id="facilities" class="k-card edu-panel" aria-labelledby="facilities-title">
        <div class="edu-panel__head">
            <h2 id="facilities-title">{{ __('What it offers, and what families report') }}</h2>
            <span class="k-chip k-chip--plain">{{ $facilityYear }}</span>
        </div>

        @if (count($facilityComparison) > 0)
            <p class="edu-panel__intro">
                {!! __('Each facility the school lists, next to what verified parents and students report experiencing. A gap is a :term, not a finding against the school: a facility can exist and still be hard to access, and the school can respond.', ['term' => '<em>'.e(__('reported difference')).'</em>']) !!}
            </p>

            <ul class="edu-rows" role="list">
                @foreach ($facilityComparison as $row)
                    @php $replies = $facilityReplies->get($row['facility_key'], collect()); @endphp
                    <li>
                        <div class="edu-rows__main">
                            <p class="edu-rows__title">
                                {{ $row['label'] }}
                                @if ($row['verification_status'] === 'verified')
                                    <span class="k-chip k-chip--success k-chip--plain">{{ __('evidence checked') }}</span>
                                @endif
                            </p>
                            <p class="edu-rows__sub">{{ $row['group'] }}</p>
                        </div>
                        <div class="edu-rows__end">
                            <span class="k-chip {{ $statusTone($row['status']) }}">{{ $row['status_label'] }}</span>
                            <p class="edu-rows__sub">
                                @if ($row['report_count'] > 0)
                                    {{ trans_choice(':count report|:count reports', $row['report_count']) }}
                                    {{-- The confidence tier is only meaningful once a status has
                                         actually been assigned; below the threshold the status
                                         already says there isn't enough to go on. --}}
                                    @if ($row['confidence'] !== 'insufficient')
                                        &middot; {{ __(':level confidence', ['level' => $row['confidence']]) }}
                                    @endif
                                @else
                                    {{ __('Awaiting reports') }}
                                @endif
                            </p>
                        </div>

                        {{-- Spec section 29: both sides. The school's answer
                             sits beside the report, never in place of it. --}}
                        @foreach ($replies as $reply)
                            <blockquote class="edu-quote">
                                <p class="edu-quote__who">{{ __('Response from the school') }}</p>
                                <p>{{ $reply->body }}</p>
                                <p class="edu-rows__sub">{{ $reply->created_at->format('j M Y') }}</p>
                            </blockquote>
                        @endforeach
                    </li>
                @endforeach
            </ul>

            @if ($canSubmit)
                <a href="{{ route('facilities.rate', $school) }}" wire:navigate class="k-btn k-btn--soft mt-4">{{ __('Report on a facility') }}</a>
            @endif
        @else
            <p class="edu-none">
                {{ __('This school hasn’t listed its facilities for :year yet. Nothing is claimed here, so there is nothing to compare against.', ['year' => $facilityYear]) }}
            </p>
        @endif
    </section>

    @if ($courses->isNotEmpty())
        <section id="courses" class="k-card edu-panel" aria-labelledby="courses-title">
            <div class="edu-panel__head">
                <h2 id="courses-title">{{ __('Courses') }}</h2>
                <span class="k-chip k-chip--plain">{{ $facilityYear }}</span>
            </div>
            <p class="edu-panel__intro">
                {{ __('Rated by verified students and parents out of 5. The number in brackets is how many people answered that question — parents are only asked about things they’re in a position to see, so some dimensions have fewer responses than others.') }}
            </p>

            <div class="edu-course-list">
                @foreach ($courses as $course)
                    @php $rated = collect($courseAverages[$course->id])->where('responses', '>', 0); @endphp
                    <article class="edu-course" aria-labelledby="course-{{ $course->id }}">
                        <div class="edu-course__head">
                            <h3 id="course-{{ $course->id }}">{{ $course->name }}</h3>
                            <span class="k-chip k-chip--plain">{{ $course->typeLabel() }}</span>
                            @if ($course->applicable_classes)
                                <span class="edu-rows__sub">{{ __('Classes :classes', ['classes' => $course->applicable_classes]) }}</span>
                            @endif
                        </div>

                        @if ($rated->isNotEmpty())
                            <ul class="k-bars edu-bars--grid" role="list">
                                @foreach ($rated as $dimension)
                                    <li>
                                        <span class="k-bars__label">{{ $dimension['label'] }}</span>
                                        <span class="k-bars__value">
                                            {{ $dimension['average'] }}<span class="edu-of">/5</span>
                                            <span class="edu-count" aria-hidden="true">({{ $dimension['responses'] }})</span>
                                            <span class="k-sr-only">{{ trans_choice(':count response|:count responses', $dimension['responses']) }}</span>
                                        </span>
                                        <span class="k-bars__track" aria-hidden="true"><span class="k-bars__fill" style="--v: {{ round((float) $dimension['average'] / 5 * 100) }}"></span></span>
                                    </li>
                                @endforeach
                            </ul>
                        @else
                            <p class="edu-none">{{ __('No ratings yet.') }}</p>
                        @endif
                    </article>
                @endforeach
            </div>

            @if ($canSubmit)
                <a href="{{ route('courses.rate', $school) }}" wire:navigate class="k-btn k-btn--soft mt-4">{{ __('Rate a course') }}</a>
            @endif
        </section>
    @endif

    @if ($exams->isNotEmpty() || $coaching->isNotEmpty())
        <section id="exams" class="k-card edu-panel" aria-labelledby="exams-title">
            <div class="edu-panel__head">
                <h2 id="exams-title">{{ __('Exams & coaching') }}</h2>
                <span class="k-chip k-chip--plain">{{ __(':year · school-reported', ['year' => $facilityYear]) }}</span>
            </div>

            @if ($exams->isNotEmpty())
                <h3 class="edu-subhead">{{ __('External exams') }}</h3>
                <ul class="edu-rows" role="list">
                    @foreach ($exams as $exam)
                        <li>
                            <div class="edu-rows__main">
                                <p class="edu-rows__title">
                                    {{ $exam->exam_name }}
                                    @if ($exam->is_mandatory)
                                        <span class="k-chip k-chip--warning k-chip--plain">{{ __('compulsory') }}</span>
                                    @endif
                                </p>
                                <p class="edu-rows__sub">{{ $exam->typeLabel() }}</p>
                            </div>
                            <span class="edu-rows__amount">
                                @if ($exam->totalCost() > 0) {{ $inr($exam->totalCost()) }} @else <span aria-hidden="true">—</span><span class="k-sr-only">{{ __('No charge recorded') }}</span> @endif
                            </span>
                        </li>
                    @endforeach
                </ul>
            @endif

            @if ($coaching->isNotEmpty())
                <h3 class="edu-subhead">{{ __('Coaching & preparation') }}</h3>
                <ul class="edu-rows" role="list">
                    @foreach ($coaching as $programme)
                        <li>
                            <div class="edu-rows__main">
                                <p class="edu-rows__title">
                                    {{ $programme->programme_name }}
                                    @if ($programme->isEffectivelyCompulsory())
                                        <span class="k-chip k-chip--warning k-chip--plain">{{ $programme->is_mandatory ? __('compulsory') : __('in school hours') }}</span>
                                    @endif
                                    @if ($programme->bundled_into_school_fees)
                                        <span class="k-chip k-chip--success k-chip--plain">{{ __('in school fees') }}</span>
                                    @endif
                                </p>
                                <p class="edu-rows__sub">{{ $programme->typeLabel() }}</p>
                            </div>
                            <span class="edu-rows__amount">
                                @if ($programme->fee) {{ $inr($programme->fee) }} @else <span aria-hidden="true">—</span><span class="k-sr-only">{{ __('No charge recorded') }}</span> @endif
                            </span>
                        </li>
                    @endforeach
                </ul>
            @endif
        </section>
    @endif

    @if ($school->profile)
        <section id="about" class="k-card edu-panel" aria-labelledby="about-title">
            <h2 id="about-title" class="edu-panel__title">{{ __('About') }}</h2>
            <p class="text-muted">{{ $school->profile->about }}</p>

            <div class="grid gap-4 sm:grid-cols-2 mt-4">
                <div>
                    <h3 class="edu-subhead mt-0">{{ __('Facilities') }}</h3>
                    <ul class="edu-chips" role="list">
                        @forelse ($school->profile->facilities ?? [] as $facility)
                            <li><span class="k-chip k-chip--plain">{{ $facility }}</span></li>
                        @empty
                            <li class="edu-none">{{ __('None listed') }}</li>
                        @endforelse
                    </ul>
                </div>
                <div>
                    <h3 class="edu-subhead mt-0">{{ __('Sports') }}</h3>
                    <ul class="edu-chips" role="list">
                        @forelse ($school->profile->sports ?? [] as $sport)
                            <li><span class="k-chip k-chip--plain">{{ $sport }}</span></li>
                        @empty
                            <li class="edu-none">{{ __('None listed') }}</li>
                        @endforelse
                    </ul>
                </div>
            </div>
        </section>
    @endif

    @if ($canSubmit && $verifiedTeachers->isNotEmpty())
        <section class="k-card edu-panel" aria-labelledby="teachers-title">
            <h2 id="teachers-title" class="edu-panel__title">{{ __('Rate a teacher') }}</h2>
            <p class="edu-panel__intro">{{ __('Private and anonymous — feeds only that teacher’s own effectiveness index.') }}</p>
            <ul class="edu-chips" role="list">
                @foreach ($verifiedTeachers as $teacher)
                    <li><a href="{{ route('teacher-feedback.create', $teacher) }}" wire:navigate class="k-btn k-btn--secondary"
                        aria-label="{{ __('Rate :name', ['name' => $teacher->name]) }}">{{ $teacher->name }}</a></li>
                @endforeach
            </ul>
        </section>
    @endif

    <section id="complaints" class="k-card edu-panel" aria-labelledby="complaints-title">
        <h2 id="complaints-title" class="edu-panel__title">{{ __('Recent complaint trends') }}</h2>
        <p class="edu-panel__intro">{{ __('Category and status only — submitter identity is never shown here.') }}</p>
        @if ($recentComplaints->isEmpty())
            <p class="edu-none">{{ __('No complaints recorded.') }}</p>
        @else
            <ul class="edu-rows" role="list">
                @foreach ($recentComplaints as $c)
                    <li>
                        <div class="edu-rows__main">
                            <p class="edu-rows__title">{{ $c->category->name }}</p>
                            <p class="edu-rows__sub">{{ $c->created_at->format('j M Y') }}</p>
                        </div>
                        <x-complaint-status :status="$c->status" />
                    </li>
                @endforeach
            </ul>
        @endif
    </section>

    @guest
        <section class="k-cta" aria-labelledby="join-title">
            <div>
                <h2 id="join-title">{{ __('Are you a parent or student here?') }}</h2>
                <p>{{ __('Create a free account to rate this school or raise a concern. The school sees that a verified parent or student spoke up, never who.') }}</p>
            </div>
            <div class="k-row">
                <a href="{{ route('sign-up') }}" wire:navigate class="k-btn">{{ __('Create a free account') }}</a>
                <a href="{{ route('sign-in') }}" wire:navigate class="k-link-arrow">{{ __('Sign in') }} <x-k-icon name="arrow-right" /></a>
            </div>
        </section>
    @endguest
</div>
