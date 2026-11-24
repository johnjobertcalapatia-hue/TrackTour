<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A tourist's comment on a business post; the business can hide or delete it. */
class BusinessPostComment extends Model
{
    public const MAX_LENGTH = 1000;

    /** business_id is set when the business itself commented (written by its owner or staff, user_id). */
    protected $fillable = ['business_post_id', 'user_id', 'business_id', 'body', 'hidden_at', 'hidden_by'];

    protected function casts(): array
    {
        return ['hidden_at' => 'datetime'];
    }

    public function post(): BelongsTo
    {
        return $this->belongsTo(BusinessPost::class, 'business_post_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function scopeVisible(Builder $query): Builder
    {
        return $query->whereNull('hidden_at');
    }
}
