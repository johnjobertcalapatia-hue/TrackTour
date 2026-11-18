<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Per-service approval decided by the Tourism Office. */
class RiderServiceEligibility extends Model
{
    public const STATUS_APPROVED = 'approved';
    public const STATUS_NOT_ELIGIBLE = 'not_eligible';

    protected $fillable = ['rider_id', 'service', 'status', 'remarks', 'decided_by', 'decided_at'];

    protected $casts = ['decided_at' => 'datetime'];

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }
}
