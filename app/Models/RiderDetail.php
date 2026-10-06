<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RiderDetail extends Model
{
    protected $table = 'rider_details';

    protected $fillable = [
        'user_id',
        'referral_code',
        'vehicle_type',
        'vehicle_make',
        'vehicle_model',
        'vehicle_plate_number',
        'vehicle_year',
        'license_number',
        'license_expiry',
        'or_cr_number',
        'drivers_license_front',
        'drivers_license_back',
        'or_cr_image',
        'nbi_clearance',
        'drug_test_result',
        'rider_status',
        'rider_status_updated_at',
        'current_service',
        'auto_accept',
        'active_order_limit',
    ];

    protected $casts = [
        'vehicle_year' => 'integer',
        'license_expiry' => 'date',
        'rider_status_updated_at' => 'datetime',
        'auto_accept' => 'boolean',
        'active_order_limit' => 'integer',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

}
