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
        'working_credit',
        'reserved_working_credit',
        'active_order_limit',
    ];

    protected $casts = [
        'vehicle_year' => 'integer',
        'license_expiry' => 'date',
        'rider_status_updated_at' => 'datetime',
        'working_credit' => 'decimal:2',
        'reserved_working_credit' => 'decimal:2',
        'active_order_limit' => 'integer',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function riderCredit()
    {
        return $this->hasOne(RiderCredit::class, 'rider_id', 'user_id');
    }

    /**
     * Get the rider's available credit (working_credit - reserved_working_credit).
     */
    public function getAvailableCreditAttribute(): float
    {
        return (float) $this->working_credit - (float) $this->reserved_working_credit;
    }
}
