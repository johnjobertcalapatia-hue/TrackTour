<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TransactionCheckpointEntry extends Model
{
    public $timestamps = false;

    protected $fillable = ['checkpoint_id', 'blueprint_id', 'event_count', 'head_hash'];

    protected function casts(): array
    {
        return ['checkpoint_id' => 'integer', 'blueprint_id' => 'integer', 'event_count' => 'integer'];
    }
}
