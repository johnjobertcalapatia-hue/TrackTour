<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** A photo of a resort offering (cottage, activity, …). */
class ResortOfferingImage extends Model
{
    protected $fillable = ['resort_offering_id', 'path', 'sort_order'];
}
