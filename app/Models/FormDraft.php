<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FormDraft extends Model
{
    protected $fillable = [
        'user_id',
        'draft_key',
        'form_id',
        'fields',
        'ui_state',
        'version',
        'expires_at',
    ];

    protected function casts(): array
    {
        return [
            'fields' => 'array',
            'ui_state' => 'array',
            'version' => 'integer',
            'expires_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
