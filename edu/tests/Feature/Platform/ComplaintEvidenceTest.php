<?php

namespace Tests\Feature\Platform;

use App\Models\Complaint;
use App\Models\ComplaintEvidence;
use App\Models\School;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Evidence files sit on the private local disk and are only ever served by
 * ComplaintEvidenceController, which re-checks the complaint's view policy
 * (SECURITY_PRIVACY.md).
 */
class ComplaintEvidenceTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private function complaintWithEvidence(School $school, User $submitter): array
    {
        $complaint = Complaint::createNumbered($school->state, $school->district, [
            'school_id' => $school->id,
            'complaint_category_id' => $this->makeCategory()->id,
            'district_id' => $school->district_id,
            'state_id' => $school->state_id,
            'anonymous_ref' => $submitter->anonymousRefFor($school, 'parent'),
            'submitted_role' => 'parent',
            'subject' => 'Broken railing on the stairs',
            'description' => 'The stair railing on the first floor is loose and unsafe.',
            'status' => 'submitted',
        ]);

        $path = "complaint-evidence/{$complaint->id}/photo.jpg";
        Storage::disk('local')->put($path, 'evidence-bytes');

        $evidence = ComplaintEvidence::create([
            'complaint_id' => $complaint->id,
            'uploaded_by' => 'submitter',
            'original_filename' => 'railing.jpg',
            'stored_filename' => $path,
            'mime_type' => 'image/jpeg',
            'size_bytes' => 14,
            'disk' => 'local',
        ]);

        return [$complaint, $evidence];
    }

    public function test_submitter_and_the_schools_admin_can_download_evidence(): void
    {
        Storage::fake('local');
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);
        [$complaint, $evidence] = $this->complaintWithEvidence($school, $parent);

        $url = route('complaints.evidence.download', [$complaint, $evidence]);

        $this->actingAs($parent)->get($url)->assertOk()->assertDownload('railing.jpg');
        $this->actingAs($this->makeSchoolAdmin($school))->get($url)->assertOk();
    }

    public function test_others_cannot_download_evidence(): void
    {
        Storage::fake('local');
        $school = $this->makeSchool();
        [$complaint, $evidence] = $this->complaintWithEvidence($school, $this->makeVerifiedParent($school));
        $url = route('complaints.evidence.download', [$complaint, $evidence]);

        $this->get($url)->assertRedirect(route('login'));
        $this->actingAs($this->makeSchoolAdmin($this->makeSchool()))->get($url)->assertForbidden();
        $this->actingAs($this->makeVerifiedParent($school))->get($url)->assertForbidden();
    }

    public function test_evidence_of_another_complaint_is_not_served_through_this_one(): void
    {
        Storage::fake('local');
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);
        [$mine] = $this->complaintWithEvidence($school, $parent);
        [, $theirs] = $this->complaintWithEvidence($school, $this->makeVerifiedParent($school));

        $this->actingAs($parent)
            ->get(route('complaints.evidence.download', [$mine, $theirs]))
            ->assertNotFound();
    }
}
