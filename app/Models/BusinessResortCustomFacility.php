<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** A facility a resort owner added that isn't in the catalogue. */
class BusinessResortCustomFacility extends Model
{
    protected $fillable = ['business_id', 'name'];
}
