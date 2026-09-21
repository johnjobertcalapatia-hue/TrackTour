<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class BusinessModule extends Model
{
    protected $fillable = [
        'code',
        'name',
        'description',
        'icon',
        'route_prefix',
        'sort_order',
        'archived_at',
    ];

    protected function casts(): array
    {
        return [
            'archived_at' => 'datetime',
        ];
    }

    public function categories(): BelongsToMany
    {
        return $this->belongsToMany(BusinessCategory::class, 'business_type_module', 'business_module_id', 'business_category_id');
    }

    public function businesses(): BelongsToMany
    {
        return $this->belongsToMany(Business::class, 'business_module_assignments', 'business_module_id', 'business_id')
            ->withPivot('is_active')
            ->withTimestamps();
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
