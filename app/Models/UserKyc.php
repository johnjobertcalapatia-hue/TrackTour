<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class UserKyc extends Model
{
    protected $table = 'user_kyc';

    protected $fillable = [
        'user_id',
        'government_id_type',
        'government_id_number',
        'valid_id_front',
        'valid_id_back',
        'selfie_holding_id',
        'tin',
        'verification_status',
        'verified_at',
    ];

    protected $hidden = [
        'valid_id_front',
        'valid_id_back',
        'selfie_holding_id',
    ];

    protected function casts(): array
    {
        return [
            'verified_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
