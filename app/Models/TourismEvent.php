<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TourismEvent extends Model
{
    protected $fillable = [
        'municipality_id', 'name', 'description', 'location',
        'start_date', 'end_date', 'image', 'status',
    ];

    protected function casts(): array
    {
        return [
            'start_date' => 'datetime',
            'end_date' => 'datetime',
        ];
    }

    public function municipality()
    {
        return $this->belongsTo(Municipality::class);
    }
}
