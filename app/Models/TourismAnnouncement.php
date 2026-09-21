<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TourismAnnouncement extends Model
{
    protected $fillable = [
        'municipality_id', 'title', 'content', 'type', 'status', 'published_at',
    ];

    protected function casts(): array
    {
        return [
            'published_at' => 'datetime',
        ];
    }

    public function municipality()
    {
        return $this->belongsTo(Municipality::class);
    }
}
