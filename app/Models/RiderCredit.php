<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RiderCredit extends Model
{
    protected $fillable = [
        'rider_id',
        'total_credits',
        'reserved_credits',
        'minimum_reserve',
    ];

    protected function casts(): array
    {
        return [
            'total_credits' => 'decimal:2',
            'reserved_credits' => 'decimal:2',
            'minimum_reserve' => 'decimal:2',
        ];
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(RiderCreditTransaction::class, 'rider_id', 'rider_id');
    }

    public function topUps(): HasMany
    {
        return $this->hasMany(RiderTopUp::class, 'rider_id', 'rider_id');
    }

    /**
     * Get usable credits (total - protected reserve - reserved).
     */
    public function getUsableCreditsAttribute(): float
    {
        $total = (float) $this->total_credits;
        $reserved = (float) $this->reserved_credits;
        $minimum = (float) $this->minimum_reserve;

        return max(0, $total - $minimum - $reserved);
    }

    /**
     * Check if rider is COD eligible.
     */
    public function isCodEligible(): bool
    {
        return $this->usable_credits > 0;
    }

    /**
     * Check if rider has sufficient usable credits for a given amount.
     */
    public function hasSufficientCredits(float $amount): bool
    {
        return $this->usable_credits >= $amount;
    }

    /**
     * Check if a reservation would violate the protected reserve.
     */
    public function wouldViolateReserve(float $amount): bool
    {
        $total = (float) $this->total_credits;
        $reserved = (float) $this->reserved_credits;
        $minimum = (float) $this->minimum_reserve;

        // After reservation, total - reserved - amount must be >= minimum
        return ($total - $reserved - $amount) < $minimum;
    }

    /**
     * Top up credits after successful GCash payment via PayMongo.
     */
    public function topUp(float $amount, string $paymentId, ?string $description = null): bool
    {
        $balanceBefore = (float) $this->total_credits;

        $this->increment('total_credits', $amount);

        RiderCreditTransaction::create([
            'rider_id' => $this->rider_id,
            'order_id' => null,
            'transaction_type' => 'TOP_UP',
            'amount' => $amount,
            'balance_before' => $balanceBefore,
            'balance_after' => $balanceBefore + $amount,
            'reference' => $paymentId,
            'description' => $description ?? "Top-up of ₱{$amount} via GCash",
        ]);

        return true;
    }

    /**
     * Reserve credits for a COD order. Returns true on success.
     */
    public function reserve(float $amount, ?int $orderId = null, ?string $description = null): bool
    {
        if (!$this->hasSufficientCredits($amount)) {
            return false;
        }

        // Check protected reserve constraint
        if ($this->wouldViolateReserve($amount)) {
            return false;
        }

        $balanceBefore = (float) $this->total_credits;
        $reservedBefore = (float) $this->reserved_credits;

        $this->update([
            'reserved_credits' => $reservedBefore + $amount,
        ]);

        RiderCreditTransaction::create([
            'rider_id' => $this->rider_id,
            'order_id' => $orderId,
            'transaction_type' => 'COD_RESERVE',
            'amount' => $amount,
            'balance_before' => $balanceBefore,
            'balance_after' => $balanceBefore,
            'reserved_before' => $reservedBefore,
            'reserved_after' => $reservedBefore + $amount,
            'description' => $description ?? "Reserved ₱{$amount} for COD order #{$orderId}",
        ]);

        return true;
    }

    /**
     * Release reserved credits after cancelled COD delivery.
     */
    public function release(float $amount, ?int $orderId = null, ?string $description = null): bool
    {
        $balanceBefore = (float) $this->total_credits;
        $reservedBefore = (float) $this->reserved_credits;

        $this->update([
            'reserved_credits' => max(0, $reservedBefore - $amount),
        ]);

        RiderCreditTransaction::create([
            'rider_id' => $this->rider_id,
            'order_id' => $orderId,
            'transaction_type' => 'COD_RELEASE',
            'amount' => $amount,
            'balance_before' => $balanceBefore,
            'balance_after' => $balanceBefore,
            'reserved_before' => $reservedBefore,
            'reserved_after' => max(0, $reservedBefore - $amount),
            'description' => $description ?? "Released ₱{$amount} from cancelled COD order #{$orderId}",
        ]);

        return true;
    }

    /**
     * Finalize credits after completed COD delivery.
     *
     * The rider pre-funded the order from their wallet (subtotal + system fee)
     * and keeps the customer's cash at the drop-off. Settling therefore debits
     * the wallet by the financed amount (recovering that cost) while freeing
     * the reservation, leaving the rider's earnings (delivery fee + tip)
     * outside the wallet.
     */
    public function finalize(float $amount, ?int $orderId = null, ?string $description = null): bool
    {
        $balanceBefore = (float) $this->total_credits;
        $reservedBefore = (float) $this->reserved_credits;
        $balanceAfter = max(0, (float) $balanceBefore - $amount);
        $reservedAfter = max(0, (float) $reservedBefore - $amount);

        $this->update([
            'total_credits' => $balanceAfter,
            'reserved_credits' => $reservedAfter,
        ]);

        RiderCreditTransaction::create([
            'rider_id' => $this->rider_id,
            'order_id' => $orderId,
            'transaction_type' => 'COD_SETTLEMENT',
            'amount' => $amount,
            'balance_before' => $balanceBefore,
            'balance_after' => $balanceAfter,
            'reserved_before' => $reservedBefore,
            'reserved_after' => $reservedAfter,
            'description' => $description ?? "Finalized ₱{$amount} for COD order #{$orderId}",
        ]);

        return true;
    }
}
