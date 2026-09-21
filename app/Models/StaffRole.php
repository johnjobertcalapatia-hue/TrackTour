<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StaffRole extends Model
{
    protected $fillable = [
        'name',
        'description',
    ];

    public function businessCategories(): BelongsToMany
    {
        return $this->belongsToMany(BusinessCategory::class, 'business_category_staff_role');
    }

    public function staff(): HasMany
    {
        return $this->hasMany(Staff::class);
    }

    public function permissions(): HasMany
    {
        return $this->hasMany(RolePermission::class);
    }

    public function hasPermission(string $moduleCode, string $action = 'can_view'): bool
    {
        $permission = $this->permissions()->where('module_code', $moduleCode)->first();

        return $permission ? $permission->{$action} : false;
    }

    public function getPermissionsByModule(): array
    {
        return $this->permissions->groupBy('module_code')->map(function ($perms) {
            return $perms->first();
        })->toArray();
    }
}
