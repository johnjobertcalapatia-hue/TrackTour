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
    ];

    protected function casts(): array
    {
        return [
            'auto_preparation_prediction_enabled' => 'boolean',
        ];
    }

    public function restaurant(): BelongsTo
    {
        return $this->belongsTo(Business::class, 'restaurant_id');
    }
}
