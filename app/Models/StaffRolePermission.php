<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A permission key (App\Support\StaffPermissions) granted to a staff role. */
class StaffRolePermission extends Model
{
    protected $fillable = ['staff_role_id', 'permission'];

    public function staffRole(): BelongsTo
    {
        return $this->belongsTo(StaffRole::class);
    }
}
