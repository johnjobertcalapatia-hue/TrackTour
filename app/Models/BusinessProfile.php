<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BusinessProfile extends Model
{
    protected $fillable = [
        'business_id',
        'welcome_message',
        'about_us',
        'mission',
        'vision',
        'featured_banner',
        'featured_video',
        'theme_settings',
        'profile_layout',
    ];

    protected function casts(): array
    {
        return [
            'theme_settings' => 'array',
        ];
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }
}
