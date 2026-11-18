<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Tourism Office operating expense (subtracted from platform revenue for net income). */
class PlatformExpense extends Model
{
    public const CATEGORIES = ['operations', 'personnel', 'marketing', 'technology', 'events', 'transport', 'utilities', 'other'];

    protected $fillable = ['municipality_id', 'category', 'description', 'amount', 'expense_date', 'recorded_by'];

    protected $casts = ['amount' => 'decimal:2', 'expense_date' => 'date'];

    public function recorder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }

    public function municipality(): BelongsTo
    {
        return $this->belongsTo(Municipality::class);
    }
}
