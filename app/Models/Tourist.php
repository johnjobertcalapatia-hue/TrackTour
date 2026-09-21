<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Tourist extends Model
{
    protected $fillable = [
        'user_id',
        'first_name',
        'last_name',
        'dob',
        'nationality',
        'bio',
        'preferences',
    ];

    protected $casts = [
        'preferences' => 'array',
        'dob' => 'date',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
