<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BusinessPostMedia extends Model
{
    protected $table = 'business_post_media';

    protected $fillable = ['business_post_id', 'type', 'path', 'mime', 'size', 'sort_order'];

    protected function casts(): array
    {
        return ['size' => 'integer', 'sort_order' => 'integer'];
    }

    public function post(): BelongsTo
    {
        return $this->belongsTo(BusinessPost::class, 'business_post_id');
    }
}
