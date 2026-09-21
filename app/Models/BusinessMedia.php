<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class BusinessMedia extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'business_id',
        'type',
        'title',
        'category',
        'file_path',
        'caption',
        'sort_order',
        'featured',
        'visibility',
        'status',
    ];

    protected $casts = [
        'featured' => 'boolean',
        'sort_order' => 'integer',
    ];

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }
}
