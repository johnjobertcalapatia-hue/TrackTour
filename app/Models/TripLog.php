<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TripLog extends Model
{
    protected $fillable = [
        'delivery_id',
        'rider_id',
        'distance_meters',
        'duration_seconds',
        'average_speed_kph',
        'encoded_polyline',
        'point_count',
        'started_at',
        'ended_at',
    ];

    protected function casts(): array
    {
        return [
            'distance_meters' => 'float',
            'duration_seconds' => 'integer',
            'average_speed_kph' => 'float',
            'point_count' => 'integer',
            'started_at' => 'datetime',
            'ended_at' => 'datetime',
        ];
    }

    public function delivery(): BelongsTo
    {
        return $this->belongsTo(Delivery::class);
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }
}
