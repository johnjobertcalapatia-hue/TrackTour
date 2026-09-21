<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Models\RequiredDocument;

class BusinessCategory extends Model
{
    protected $fillable = [
        'name',
        'description',
        'archived_at',
    ];

    protected function casts(): array
    {
        return [
            'archived_at' => 'datetime',
        ];
    }

    public function businesses(): HasMany
    {
        return $this->hasMany(Business::class);
    }

    public function modules(): BelongsToMany
    {
        return $this->belongsToMany(BusinessModule::class, 'business_type_module', 'business_category_id', 'business_module_id');
    }

    public function enabledModuleCodes(): array
    {
        return $this->modules()->pluck('code')->toArray();
    }

    public function staffRoles(): BelongsToMany
    {
        return $this->belongsToMany(StaffRole::class, 'business_category_staff_role');
    }

    public function requiredDocuments(): HasMany
    {
        return $this->hasMany(RequiredDocument::class, 'business_category_id')->orderBy('sort_order');
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
