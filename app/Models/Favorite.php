<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Favorite extends Model
{
    use SoftDeletes;

    protected $fillable = ['user_id', 'favoritable_type', 'favoritable_id'];

    public function favoritable(): MorphTo
    {
        return $this->morphTo();
    }
}
