<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A business post (Promotions Part B): caption + up to 10 photos or one video,
 * optionally linked to a dish sale. Tourists only ever see published posts of
 * approved businesses (scopeVisibleToTourists); hidden posts stay with the
 * owner and deleted posts are gone (their files too).
 */
class BusinessPost extends Model
{
    public const STATUS_PUBLISHED = 'published';

    public const STATUS_HIDDEN = 'hidden';

    /** Never published yet; never shown to tourists. */
    public const STATUS_DRAFT = 'draft';

    public const MAX_PHOTOS = 10;

    protected $fillable = ['business_id', 'created_by', 'caption', 'status', 'promotion_id', 'likes_count', 'published_at'];

    /** Recomputed counters (App\Services\PostEngagement); never mass-assigned. */
    public const COUNTERS = ['likes_count', 'views_count', 'unique_viewers_count', 'comments_count', 'saves_count', 'shares_count'];

    protected function casts(): array
    {
        return [
            'published_at' => 'datetime',
            'likes_count' => 'integer',
            'views_count' => 'integer',
            'unique_viewers_count' => 'integer',
            'comments_count' => 'integer',
            'saves_count' => 'integer',
            'shares_count' => 'integer',
        ];
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function promotion(): BelongsTo
    {
        return $this->belongsTo(Promotion::class);
    }

    public function media(): HasMany
    {
        return $this->hasMany(BusinessPostMedia::class)->orderBy('sort_order')->orderBy('id');
    }

    public function likes(): HasMany
    {
        return $this->hasMany(BusinessPostLike::class);
    }

    public function comments(): HasMany
    {
        return $this->hasMany(BusinessPostComment::class);
    }

    public function saves(): HasMany
    {
        return $this->hasMany(BusinessPostSave::class);
    }

    public function scopeVisibleToTourists(Builder $query): Builder
    {
        return $query->where('status', self::STATUS_PUBLISHED)
            ->whereNotNull('published_at')
            ->where('published_at', '<=', now())
            ->whereHas('business', fn ($b) => $b->where('status', 'approved'));
    }

    public function isVisibleToTourists(): bool
    {
        return $this->status === self::STATUS_PUBLISHED
            && $this->published_at !== null
            && $this->published_at->lte(now())
            && $this->business?->status === 'approved';
    }
}
