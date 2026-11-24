<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BusinessPostSave extends Model
{
    protected $fillable = ['business_post_id', 'user_id'];

    public function post(): BelongsTo
    {
        return $this->belongsTo(BusinessPost::class, 'business_post_id');
    }
}
