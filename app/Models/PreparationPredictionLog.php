<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PreparationPredictionLog extends Model
{
    protected $fillable = [
        'restaurant_id',
        'menu_item_id',
        'restaurant_order_id',
        'prediction_source',
        'predicted_seconds',
        'actual_seconds',
        'error_seconds',
        'model_version',
    ];

    protected function casts(): array
    {
        return [
            'predicted_seconds' => 'integer',
            'actual_seconds' => 'integer',
            'error_seconds' => 'integer',
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
}
