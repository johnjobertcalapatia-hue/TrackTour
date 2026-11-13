<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/** HMAC-signed snapshot of chain heads (append-only, like the events). */
class TransactionCheckpoint extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['sequence', 'entries_count', 'previous_root', 'root_hash', 'signature', 'key_id', 'created_at_ms', 'export_path'];

    protected function casts(): array
    {
        return ['sequence' => 'integer', 'entries_count' => 'integer', 'created_at_ms' => 'integer'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Checkpoints are append-only.'));
        static::deleting(fn () => throw new LogicException('Checkpoints are append-only.'));
    }

    public function entries(): HasMany
    {
        return $this->hasMany(TransactionCheckpointEntry::class, 'checkpoint_id')->orderBy('blueprint_id');
    }
}
