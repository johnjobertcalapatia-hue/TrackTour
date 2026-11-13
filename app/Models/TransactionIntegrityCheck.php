<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TransactionIntegrityCheck extends Model
{
    public const UPDATED_AT = null;

    public const PASS = 'pass';

    public const FLAG = 'flag';

    public const BLOCK = 'block';

    protected $fillable = ['blueprint_id', 'result', 'checks', 'context', 'context_id', 'checked_by'];

    protected function casts(): array
    {
        return ['checks' => 'array'];
    }
}
