<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class BusinessDocument extends Model
{
    use SoftDeletes;

    protected $table = 'business_document_uploads';

    protected $fillable = [
        'business_id',
        'required_document_id',
        'document_number',
        'registered_name',
        'issued_by',
        'issue_date',
        'expiration_date',
        'file_path',
        'verification_status',
        'admin_remarks',
        'owner_remarks',
        'flagged',
        'flag_reason',
        'ocr_data',
        'verified_by',
        'verified_at',
    ];

    protected $hidden = [
        'file_path',
    ];

    protected function casts(): array
    {
        return [
            'issue_date' => 'date:Y-m-d',
            'expiration_date' => 'date:Y-m-d',
            'verified_at' => 'datetime',
            'flagged' => 'boolean',
            'ocr_data' => 'array',
        ];
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function requiredDocument(): BelongsTo
    {
        return $this->belongsTo(RequiredDocument::class);
    }

    public function verifier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'verified_by');
    }
}
