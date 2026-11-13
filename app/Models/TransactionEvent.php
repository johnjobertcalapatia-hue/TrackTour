<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * One append-only, hash-linked event in a transaction blueprint:
 * current_hash = SHA256(previous_hash + "\n" + canonical event data).
 * Corrections are new events; rows are never updated or deleted (the
 * database refuses it with triggers, and so does this model).
 */
class TransactionEvent extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'blueprint_id', 'sequence', 'event_type', 'actor_id', 'actor_role', 'source_type', 'source_id',
        'payload', 'recorded_at_ms', 'previous_hash', 'current_hash', 'schema_version',
    ];

    protected function casts(): array
    {
        return [
            'sequence' => 'integer',
            'actor_id' => 'integer',
            'source_id' => 'integer',
            'payload' => 'array',
            'recorded_at_ms' => 'integer',
            'schema_version' => 'integer',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Transaction events are append-only.'));
        static::deleting(fn () => throw new LogicException('Transaction events are append-only.'));
    }

    public function blueprint(): BelongsTo
    {
        return $this->belongsTo(TransactionBlueprint::class, 'blueprint_id');
    }
}
