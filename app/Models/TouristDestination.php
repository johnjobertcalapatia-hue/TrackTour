<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TouristDestination extends Model
{
    protected $fillable = [
        'municipality_id', 'category_id', 'name', 'slug', 'description',
        'address', 'latitude', 'longitude', 'opening_hours', 'entrance_fee',
        'contact_number', 'images', 'amenities', 'status',
    ];

    protected function casts(): array
    {
        return [
            'images' => 'array',
            'amenities' => 'array',
            'latitude' => 'decimal:7',
            'longitude' => 'decimal:7',
            'entrance_fee' => 'decimal:2',
        ];
    }

    public function municipality()
    {
        return $this->belongsTo(Municipality::class);
    }

    public function category()
    {
        return $this->belongsTo(TourismCategory::class, 'category_id');
    }
}
