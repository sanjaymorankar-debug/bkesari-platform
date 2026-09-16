<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\CapabilityObservation;
use App\Models\CareerInterestProfile;
use App\Models\CounsellingSession;
use App\Models\DataSubjectRequest;
use App\Models\LifeSkillRecord;
use App\Models\PhysicalHealthRecord;
use App\Models\User;
use App\Models\WellbeingConcern;
use App\Support\DataRetention;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Spec sections 21 and 40 — DPDP data-subject requests, and the erasure that
 * actually follows one.
 *
 * The design decision that shapes this class: **erasure is partial by default
 * and says so.** A request that touches safeguarding records, consent records
 * or audit logs is granted for everything else and refused for those, with the
 * reason recorded per category. Silently skipping them would let a requester
 * believe data was gone when it was not; refusing the whole request would deny
 * them the parts they are entitled to.
 *
 * The protected categories are not an escape hatch for the platform's
 * convenience. Each exists because erasing it would harm someone:
 *
 * - a safeguarding record removable on request is a child protection case an
 *   accused adult could get cleared;
 * - a consent record is the evidence that past collection was lawful;
 * - an audit log that can be erased is not an audit log.
 */
class DataSubjectRequestService
{
    public function __construct(private readonly ConsentService $consent) {}

    /**
     * Who may ask about whose data: yourself, or a child you are a verified
     * guardian of. Nobody else, ever — a request is a route to a person's
     * data, so the authorisation has to be as tight as the read paths.
     */
    public function canRequestFor(User $requester, int $subjectUserId): bool
    {
        return $requester->id === $subjectUserId
            || $this->consent->isVerifiedGuardian($requester, $subjectUserId);
    }

    /**
     * @param  list<string>  $categories
     *
     * @throws ValidationException
     */
    public function submit(
        User $requester,
        int $subjectUserId,
        string $type,
        array $categories,
        ?string $detail = null,
    ): DataSubjectRequest {
        abort_unless($this->canRequestFor($requester, $subjectUserId), 403,
            'You can only make a request about your own data, or your child\'s.');

        if (! array_key_exists($type, DataSubjectRequest::TYPES)) {
            throw ValidationException::withMessages(['request_type' => 'Choose what you are asking for.']);
        }

        $categories = array_values(array_intersect($categories, array_keys(DataRetention::CATEGORIES)));

        if ($categories === []) {
            throw ValidationException::withMessages([
                'categories' => 'Choose at least one kind of information.',
            ]);
        }

        $request = DataSubjectRequest::create([
            'reference' => DataSubjectRequest::generateReference(),
            'requester_user_id' => $requester->id,
            'subject_user_id' => $subjectUserId,
            'request_type' => $type,
            'categories' => $categories,
            'detail' => $detail,
            'due_by' => now()->addDays(DataSubjectRequest::RESPONSE_DAYS),
        ]);

        AuditLog::record('data_subject_request.submitted', $requester->id, $request, [
            'type' => $type,
            'categories' => $categories,
        ]);

        return $request;
    }

    /**
     * Carry out an erasure request.
     *
     * Deletes what can lawfully be deleted, records what could not and why,
     * and never reports a protected category as erased.
     */
    public function fulfilErasure(User $officer, DataSubjectRequest $request, ?string $note = null): DataSubjectRequest
    {
        $this->assertOfficer($officer);

        if ($request->request_type !== 'erasure') {
            throw ValidationException::withMessages([
                'request' => 'This is not an erasure request.',
            ]);
        }

        $scope = $request->erasureScope();
        $outcome = [];

        DB::transaction(function () use ($scope, $request, &$outcome): void {
            foreach ($scope['erasable'] as $category) {
                $deleted = $this->eraseCategory($request->subject_user_id, $category);

                $outcome[$category] = [
                    'result' => 'erased',
                    'records' => $deleted,
                ];
            }

            foreach ($scope['protected'] as $category) {
                $outcome[$category] = [
                    'result' => 'kept',
                    'reason' => DataRetention::basis($category),
                ];
            }
        });

        $status = match (true) {
            $scope['erasable'] === [] => 'refused',
            $scope['protected'] === [] => 'completed',
            default => 'partially_completed',
        };

        $request->forceFill([
            'status' => $status,
            'outcome_by_category' => $outcome,
            'response_note' => $note,
            'handled_by_user_id' => $officer->id,
            'handled_at' => now(),
        ])->save();

        // The audit row survives the erasure it records — that is the point of
        // audit logs being a protected category.
        AuditLog::record('data_subject_request.erasure_fulfilled', $officer->id, $request, [
            'status' => $status,
            'categories_erased' => $scope['erasable'],
            'categories_kept' => $scope['protected'],
        ]);

        return $request;
    }

    /** Mark an access or correction request dealt with. */
    public function complete(User $officer, DataSubjectRequest $request, string $note): DataSubjectRequest
    {
        $this->assertOfficer($officer);

        if (trim($note) === '') {
            throw ValidationException::withMessages([
                'note' => 'Record what you did, so the requester has an answer on file.',
            ]);
        }

        $request->forceFill([
            'status' => 'completed',
            'response_note' => $note,
            'handled_by_user_id' => $officer->id,
            'handled_at' => now(),
        ])->save();

        AuditLog::record('data_subject_request.completed', $officer->id, $request);

        return $request;
    }

    /**
     * Delete one category's records for a subject.
     *
     * Only ever called for categories DataRetention marks erasable — the
     * protected ones have no branch here at all, so a future edit cannot
     * accidentally wire one up.
     */
    private function eraseCategory(int $subjectUserId, string $category): int
    {
        return match ($category) {
            'capability_growth' => CapabilityObservation::where('student_user_id', $subjectUserId)->delete(),
            'career_pathway' => CareerInterestProfile::where('student_user_id', $subjectUserId)->delete(),
            'life_skills' => LifeSkillRecord::where('student_user_id', $subjectUserId)->delete(),
            'physical_health' => PhysicalHealthRecord::where('student_user_id', $subjectUserId)->delete(),
            'mental_wellbeing' => CounsellingSession::where('student_user_id', $subjectUserId)->delete()
                + WellbeingConcern::where('student_user_id', $subjectUserId)->delete(),
            default => 0,
        };
    }

    private function assertOfficer(User $user): void
    {
        abort_unless(
            $user->hasAnyRole(['data_protection_officer', 'system_admin']),
            403,
            'Only the Data Protection Officer can act on these requests.'
        );
    }
}
