<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RiderTrainingAssessment extends Model
{
    protected $fillable = ['rider_id', 'appointment_id', 'score', 'result', 'items', 'notes', 'recorded_by'];

    protected $casts = ['score' => 'integer', 'items' => 'array'];

    public function recorder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }
}
