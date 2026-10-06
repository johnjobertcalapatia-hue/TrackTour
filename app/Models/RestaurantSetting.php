<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RestaurantSetting extends Model
{
    protected $table = 'restaurant_settings';

    protected $fillable = [
        'restaurant_id',
        'auto_preparation_prediction_enabled',
        'priority_preparation_reduction_enabled',
        'priority_reduction_minutes_25',
        'priority_reduction_minutes_50',
        'priority_reduction_minutes_100',
    ];

    protected function casts(): array
    {
        return [
            'auto_preparation_prediction_enabled' => 'boolean',
            'priority_preparation_reduction_enabled' => 'boolean',
            'priority_reduction_minutes_25' => 'integer',
            'priority_reduction_minutes_50' => 'integer',
            'priority_reduction_minutes_100' => 'integer',
        ];
    }

    public function restaurant(): BelongsTo
    {
        return $this->belongsTo(Business::class, 'restaurant_id');
    }
}
