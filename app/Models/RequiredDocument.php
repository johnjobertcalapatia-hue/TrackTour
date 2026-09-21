<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RequiredDocument extends Model
{
    protected $fillable = [
        'business_category_id',
        'document_name',
        'document_code',
        'is_required',
        'has_expiration',
        'validity_period',
        'description',
        'required_fields',
        'is_active',
        'sort_order',
        'grace_period_days',
        'effective_date',
        'archived_at',
    ];

    protected function casts(): array
    {
        return [
            'is_required' => 'boolean',
            'has_expiration' => 'boolean',
            'is_active' => 'boolean',
            'required_fields' => 'array',
            'effective_date' => 'datetime',
            'archived_at' => 'datetime',
        ];
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(BusinessCategory::class, 'business_category_id');
    }

    public function scopeActive($query)
    {
        return $query->where('is_active', true)->whereNull('archived_at');
    }

    public function scopeNotArchived($query)
    {
        return $query->whereNull('archived_at');
    }

    public function archive(): void
    {
        $this->update(['archived_at' => now()]);
    }

    public function unarchive(): void
    {
        $this->update(['archived_at' => null]);
    }

    public function getIsArchivedAttribute(): bool
    {
        return $this->archived_at !== null;
    }
}
