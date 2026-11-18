<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One itemised ride charge (2026-11-18): pickup waiting now; stops later. */
class RideAdditionalCharge extends Model
{
    public const TYPE_PICKUP_WAITING = 'pickup_waiting';

    public const STATUS_APPROVED = 'approved';

    protected $fillable = [
        'order_id', 'delivery_id', 'charge_type', 'charge_key', 'start_event_id', 'end_event_id',
        'duration_seconds', 'free_seconds', 'unit_seconds', 'rate', 'method', 'amount', 'status',
    ];

    protected function casts(): array
    {
        return [
            'duration_seconds' => 'integer',
            'free_seconds' => 'integer',
            'unit_seconds' => 'integer',
            'rate' => 'float',
            'amount' => 'float',
        ];
    }

    public function present(): array
    {
        return [
            'id' => $this->id,
            'type' => $this->charge_type,
            'label' => match ($this->charge_type) {
                self::TYPE_PICKUP_WAITING => 'Pickup waiting',
                default => ucfirst(str_replace('_', ' ', $this->charge_type)),
            },
            'duration_seconds' => $this->duration_seconds,
            'free_seconds' => $this->free_seconds,
            'unit_seconds' => $this->unit_seconds,
            'rate' => $this->rate,
            'method' => $this->method,
            'amount' => $this->amount,
            'status' => $this->status,
        ];
    }
}
