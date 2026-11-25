<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A resort's own settings (Stage 7): its cancellation policy, inside the Tourism Office limits. */
class ResortSetting extends Model
{
    protected $fillable = ['business_id', 'cancellation_free_days', 'cancellation_penalty_percent'];

    protected function casts(): array
    {
        return [
            'cancellation_free_days' => 'integer',
            'cancellation_penalty_percent' => 'integer',
        ];
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }
}
