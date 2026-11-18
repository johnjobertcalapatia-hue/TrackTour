<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One final onboarding decision (approve / partially approve / reject / return). */
class RiderApprovalRecord extends Model
{
    protected $fillable = ['rider_id', 'decision', 'services', 'remarks', 'decided_by', 'decided_at'];

    protected $casts = ['services' => 'array', 'decided_at' => 'datetime'];

    public function decider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'decided_by');
    }
}
