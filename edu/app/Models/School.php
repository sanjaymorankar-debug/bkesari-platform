<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[Fillable([
    'school_code', 'udise_code', 'name', 'board', 'management_type', 'state_id', 'district_id',
    'address', 'city', 'pincode', 'phone', 'email', 'website', 'recognition_status',
    'classes_from', 'classes_to', 'student_count', 'teacher_count', 'established_year',
])]
class School extends Model
{
    protected function casts(): array
    {
        return ['udise_verified_at' => 'datetime'];
    }

    /**
     * Spec section 8: the "UDISE Verified School" badge may appear only when a
     * code has actually been confirmed against government data. Holding a code
     * is a claim; this is the verification. Never conflate the two.
     */
    public function isUdiseVerified(): bool
    {
        return $this->udise_code !== null && $this->udise_verified_at !== null;
    }

    /**
     * Record that an officer confirmed this school's UDISE code against
     * government data.
     *
     * The verification columns are deliberately absent from `$fillable`, so
     * this is the only way to set them. A school updating its own profile
     * cannot mass-assign itself a government verification, which is exactly
     * the failure mode rule 44 ("never claim government verification without
     * evidence") is guarding against.
     */
    public function markUdiseVerified(User $officer): void
    {
        if ($this->udise_code === null) {
            throw new \LogicException('A school cannot be UDISE-verified without a UDISE code on record.');
        }

        $this->forceFill([
            'udise_verified_at' => now(),
            'udise_verified_by_user_id' => $officer->id,
        ])->save();
    }

    public function state(): BelongsTo
    {
        return $this->belongsTo(State::class);
    }

    public function district(): BelongsTo
    {
        return $this->belongsTo(District::class);
    }

    public function profile(): HasOne
    {
        return $this->hasOne(SchoolProfile::class);
    }

    public function staff(): HasMany
    {
        return $this->hasMany(SchoolStaff::class);
    }

    public function complaints(): HasMany
    {
        return $this->hasMany(Complaint::class);
    }

    public function feedback(): HasMany
    {
        return $this->hasMany(SchoolFeedback::class);
    }

    public function qualityScores(): HasMany
    {
        return $this->hasMany(SchoolQualityScore::class);
    }

    public function fees(): HasMany
    {
        return $this->hasMany(Fee::class);
    }

    public function facilityClaims(): HasMany
    {
        return $this->hasMany(FacilityClaim::class);
    }

    public function courses(): HasMany
    {
        return $this->hasMany(Course::class);
    }

    public function replies(): HasMany
    {
        return $this->hasMany(SchoolReply::class);
    }

    public function courseRatings(): HasMany
    {
        return $this->hasMany(CourseRating::class);
    }

    public function externalExams(): HasMany
    {
        return $this->hasMany(ExternalExam::class);
    }

    public function coachingProgrammes(): HasMany
    {
        return $this->hasMany(CoachingProgramme::class);
    }

    public function safeguardingReports(): HasMany
    {
        return $this->hasMany(SafeguardingReport::class);
    }

    public function facilityRatings(): HasMany
    {
        return $this->hasMany(FacilityRating::class);
    }

    public function feeRevisions(): HasMany
    {
        return $this->hasMany(FeeRevision::class);
    }

    public function latestQualityScore(): HasOne
    {
        return $this->hasOne(SchoolQualityScore::class)->latestOfMany('calculated_at');
    }

    public function parentRelationships(): HasMany
    {
        return $this->hasMany(ParentSchoolRelationship::class);
    }

    public function studentRelationships(): HasMany
    {
        return $this->hasMany(StudentSchoolRelationship::class);
    }

    public function teacherRelationships(): HasMany
    {
        return $this->hasMany(TeacherSchoolRelationship::class);
    }

    public function teacherFeedback(): HasMany
    {
        return $this->hasMany(TeacherFeedback::class);
    }

    public function retaliationReports(): HasMany
    {
        return $this->hasMany(RetaliationReport::class);
    }

    /**
     * Teachers verified at this school — used to populate "rate this
     * teacher" pickers on the school profile page.
     */
    public function verifiedTeachers()
    {
        return User::whereIn('id', $this->teacherRelationships()->where('status', 'verified')->pluck('user_id'));
    }
}
