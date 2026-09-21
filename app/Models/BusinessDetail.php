<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BusinessDetail extends Model
{
    protected $fillable = [
        'business_id',
        'field_name',
        'field_value',
    ];

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }
}
