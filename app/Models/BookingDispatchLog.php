<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BookingDispatchLog extends Model
{
    protected $fillable = [
        'delivery_id',
        'rider_id',
        'distance_km',
        'attempt_no',
        'phase',
        'response',
        'dispatched_at',
        'expires_at',
        'responded_at',
    ];

    protected function casts(): array
    {
        return [
            'distance_km' => 'decimal:3',
            'dispatched_at' => 'datetime',
            'expires_at' => 'datetime',
            'responded_at' => 'datetime',
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
