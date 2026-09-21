<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TourismSetting extends Model
{
    protected $fillable = ['municipality_id', 'key', 'value'];

    public function municipality()
    {
        return $this->belongsTo(Municipality::class);
    }
}
