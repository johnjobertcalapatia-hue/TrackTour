<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RiderTrainingAttendance extends Model
{
    protected $table = 'rider_training_attendance';

    protected $fillable = ['rider_id', 'appointment_id', 'status', 'notes', 'recorded_by'];

    public function recorder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }
}
