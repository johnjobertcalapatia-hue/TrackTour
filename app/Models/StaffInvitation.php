<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * A staff activation invitation (Staff Management Stage 1). Only the token's
 * SHA-256 hash is stored; the plain token exists only in the emailed link.
 */
class StaffInvitation extends Model
{
    public const TTL_HOURS = 72;

    protected $fillable = ['staff_id', 'business_id', 'email', 'token_hash', 'invited_by', 'expires_at', 'accepted_at', 'revoked_at'];

    protected $hidden = ['token_hash'];

    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'accepted_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }

    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    /** @return array{0: self, 1: string} the invitation and its plain token */
    public static function issue(Staff $staff, ?User $invitedBy): array
    {
        $token = Str::random(64);
        $invitation = self::create([
            'staff_id' => $staff->id,
            'business_id' => $staff->business_id,
            'email' => $staff->user->email,
            'token_hash' => self::hashToken($token),
            'invited_by' => $invitedBy?->id,
            'expires_at' => now()->addHours(self::TTL_HOURS),
        ]);

        return [$invitation, $token];
    }

    public static function findByToken(string $token): ?self
    {
        return self::where('token_hash', self::hashToken($token))->first();
    }

    /** Still usable: not accepted, not revoked, not expired. */
    public function scopeOpen(Builder $query): Builder
    {
        return $query->whereNull('accepted_at')->whereNull('revoked_at')->where('expires_at', '>', now());
    }

    public function state(): string
    {
        return match (true) {
            $this->accepted_at !== null => 'accepted',
            $this->revoked_at !== null => 'revoked',
            $this->expires_at->isPast() => 'expired',
            default => 'pending',
        };
    }

    public static function activationUrl(string $token): string
    {
        return rtrim((string) (config('app.frontend_url') ?: 'http://localhost:3000'), '/').'/staff/activate/'.$token;
    }

    public function staff(): BelongsTo
    {
        return $this->belongsTo(Staff::class)->withTrashed();
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }
}
