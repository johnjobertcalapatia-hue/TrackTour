<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TourismCategory extends Model
{
    protected $fillable = ['name', 'slug', 'description', 'icon'];

    public function destinations()
    {
        return $this->hasMany(TouristDestination::class, 'category_id');
    }
}
