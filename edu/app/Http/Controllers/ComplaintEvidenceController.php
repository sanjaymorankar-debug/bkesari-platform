<?php

namespace App\Http\Controllers;

use App\Models\Complaint;
use App\Models\ComplaintEvidence;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Evidence files live on the private local disk, never public/storage —
 * every download goes through this policy-checked controller instead of a
 * direct URL (spec section AM: "uploaded files must not become publicly
 * accessible").
 */
class ComplaintEvidenceController extends Controller
{
    public function __invoke(Complaint $complaint, ComplaintEvidence $evidence): StreamedResponse
    {
        $this->authorize('view', $complaint);

        abort_unless($evidence->complaint_id === $complaint->id, 404);

        return Storage::disk($evidence->disk)->download($evidence->stored_filename, $evidence->original_filename);
    }
}
