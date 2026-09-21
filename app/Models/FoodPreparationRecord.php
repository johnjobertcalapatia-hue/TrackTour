<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FoodPreparationRecord extends Model
{
    protected $fillable = [
        'restaurant_id',
        'menu_item_id',
        'restaurant_order_id',
        'preparation_started_at',
        'ready_at',
        'predicted_preparation_seconds',
        'actual_preparation_seconds',
        'prediction_error_seconds',
        'quantity',
        'day_of_week',
        'hour_of_day',
        'kitchen_load_at_start',
        'is_valid_for_training',
    ];

    protected function casts(): array
    {
        return [
            'preparation_started_at' => 'datetime',
            'ready_at' => 'datetime',
            'predicted_preparation_seconds' => 'integer',
            'actual_preparation_seconds' => 'integer',
            'prediction_error_seconds' => 'integer',
            'quantity' => 'integer',
            'day_of_week' => 'integer',
            'hour_of_day' => 'integer',
            'is_valid_for_training' => 'boolean',
        ];
    }

    public function restaurant(): BelongsTo
    {
        return $this->belongsTo(Business::class, 'restaurant_id');
    }

    public function menuItem(): BelongsTo
    {
        return $this->belongsTo(Offering::class, 'menu_item_id');
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class, 'restaurant_order_id');
    }

    /**
     * Scope to only valid training records.
     */
    public function scopeValidForTraining($query)
    {
        return $query->where('is_valid_for_training', true)
            ->whereNotNull('preparation_started_at')
            ->whereNotNull('ready_at')
            ->whereColumn('ready_at', '>=', 'preparation_started_at');
    }
}
