<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RestaurantProfile extends Model
{
    protected $fillable = [
        'business_id',
        'chef_message',
        'restaurant_story',
        'dining_style',
        'average_wait_time',
    ];

    protected function casts(): array
    {
        return [
            'dining_style' => 'array',
            'average_wait_time' => 'integer',
        ];
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }
}
