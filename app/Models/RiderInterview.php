<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RiderInterview extends Model
{
    protected $fillable = ['rider_id', 'appointment_id', 'result', 'documents_verified', 'checklist', 'notes', 'recorded_by'];

    protected $casts = ['documents_verified' => 'boolean', 'checklist' => 'array'];

    public function recorder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }
}
