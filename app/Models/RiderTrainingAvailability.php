<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Trainer / interviewer availability override for one date at one office. */
class RiderTrainingAvailability extends Model
{
    protected $table = 'rider_training_availability';

    protected $fillable = ['municipality_id', 'date', 'trainer_available', 'interviewer_available', 'notes', 'updated_by'];

    protected $casts = [
        'date' => 'date:Y-m-d',
        'trainer_available' => 'boolean',
        'interviewer_available' => 'boolean',
    ];

    public function isSchedulable(): bool
    {
        return $this->trainer_available && $this->interviewer_available;
    }
}
