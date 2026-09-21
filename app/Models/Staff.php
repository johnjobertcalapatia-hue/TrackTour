<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Staff extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'business_id',
        'user_id',
        'staff_role_id',
        'status',
        'module_permissions',
        'employee_id',
        'middle_name',
        'suffix',
        'gender',
        'date_of_birth',
        'mobile_number',
        'address',
        'profile_picture',
        'date_hired',
        'salary_type',
        'employment_status',
        'last_login_at',
        'last_login_ip',
        'two_factor_enabled',
    ];

    protected function casts(): array
    {
        return [
            'module_permissions' => 'array',
            'date_of_birth' => 'date',
            'date_hired' => 'date',
            'last_login_at' => 'datetime',
            'two_factor_enabled' => 'boolean',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (Staff $staff) {
            if (empty($staff->employee_id)) {
                $staff->employee_id = self::generateEmployeeId();
            }
        });
    }

    public static function generateEmployeeId(): string
    {
        $last = self::withTrashed()->orderByDesc('id')->value('employee_id');
        if ($last && preg_match('/EMP-(\d+)/', $last, $m)) {
            $next = (int) $m[1] + 1;
        } else {
            $next = 1;
        }

        return 'EMP-'.str_pad($next, 5, '0', STR_PAD_LEFT);
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function staffRole(): BelongsTo
    {
        return $this->belongsTo(StaffRole::class);
    }

    public function permissions(): HasMany
    {
        return $this->hasMany(RolePermission::class, 'staff_role_id', 'staff_role_id');
    }

    public function hasModuleAccess(string $moduleCode, string $action = 'can_view'): bool
    {
        if (! $this->staffRole) {
            return false;
        }

        $permission = RolePermission::where('staff_role_id', $this->staff_role_id)
            ->where('module_code', $moduleCode)
            ->first();

        return $permission ? $permission->{$action} : false;
    }

    public function getAccessibleModulesAttribute(): array
    {
        return $this->module_permissions ?? [];
    }

    public function getFullNameAttribute(): string
    {
        $name = trim(($this->user->profile?->first_name ?? '').' '.($this->middle_name ?? '').' '.($this->user->profile?->last_name ?? ''));

        return $name ?: ($this->user->email ?? 'Unknown');
    }

    public function getInitialsAttribute(): string
    {
        $first = substr($this->user->profile?->first_name ?? '', 0, 1);
        $last = substr($this->user->profile?->last_name ?? '', 0, 1);

        return strtoupper($first.$last);
    }

    public function getProfilePictureUrlAttribute(): ?string
    {
        if ($this->profile_picture) {
            return \Storage::url($this->profile_picture);
        }

        return null;
    }

    public function getStatusLabelAttribute(): string
    {
        return match ($this->status) {
            'active' => 'Active',
            'inactive' => 'Inactive',
            'suspended' => 'Suspended',
            'archived' => 'Archived',
            default => ucfirst($this->status),
        };
    }

    public function getStatusColorAttribute(): string
    {
        return match ($this->status) {
            'active' => 'emerald',
            'inactive' => 'gray',
            'suspended' => 'red',
            'archived' => 'amber',
            default => 'gray',
        };
    }
}
