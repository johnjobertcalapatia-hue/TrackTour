<?php

namespace App\Services;

use App\Exceptions\ResortUnavailableException;
use App\Models\Booking;
use App\Models\BookingItem;
use App\Models\BookingStatusLog;
use App\Models\Business;
use App\Models\Payment;
use App\Models\Refund;
use App\Models\ResortOffering;
use App\Models\User;
use App\Support\ResortCancellationPolicy;
use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Resort reservations, Stage 7 (docs/resort-reservation-architecture.md §11).
 *
 * quote(): checks every rule and prices the stay (read-only).
 * create(): the same checks, then — in one transaction — reserves the units
 *   (ResortAvailabilityService, row locks), writes the booking, its priced item
 *   snapshots and the first status-log entry. Pay at the resort only in Stage 7
 *   (GCash comes in Stage 8). A repeated client_reference returns the same booking.
 * Status changes lock the booking row, check the transition, release the units
 *   on reject / cancel / no-show, log who did it and why, and notify the other side.
 *
 * GCash (Stage 8): a GCash reservation holds its units for HOLD_MINUTES while it
 *   awaits payment (the owner is told only once it is paid, and can confirm or
 *   reject only then); unpaid holds expire and release their units. A payment that
 *   arrives after the reservation expired or was cancelled is refunded in full.
 *   Refunds (PaymentRefundProcessor: one PayMongo call per refund, "requested" first):
 *   owner reject / cancel 100%; tourist cancel = the snapshotted policy (free period
 *   100%, then 100 − penalty %); no-show none. refund_due records what is owed so a
 *   refund PayMongo refused is retried (at most MAX_REFUND_ATTEMPTS).
 *
 * Pricing per line (nights = 1 for day-based offerings):
 *   per_person  price × people × nights     per_unit  price × units × nights
 *   per_night   price × units × nights      per_hour  price × hours × quantity
 *   per_booking price (flat)
 * "people" is the line's guests for unit offerings, the quantity for capacity / slot offerings.
 */
final class ResortReservationService
{
    public const MAX_GUESTS = 200;

    /** How long an unpaid GCash reservation holds its units. */
    public const HOLD_MINUTES = 30;

    public const MAX_REFUND_ATTEMPTS = 5;

    public function __construct(
        private ResortAvailabilityService $availability,
        private InboxNotifier $inbox,
        private PaymentRefundProcessor $refunds,
    ) {}

    /**
     * @param  array{check_in: string, check_out?: ?string, guests: int, lines: list<array{offering_id: int, quantity: int, guests?: ?int, slot?: ?string}>}  $input
     * @return array{check_in: string, check_out: ?string, nights: int, guests: int, lines: list<array>, total: float, policy: array}
     */
    public function quote(Business $business, array $input): array
    {
        $priced = $this->price($business, $input);
        $this->availability->assertAvailable($business, $priced['claims']);
        unset($priced['claims']);

        return $priced;
    }

    /**
     * @param  array{check_in: string, check_out?: ?string, guests: int, lines: list<array>, customer_name: string, customer_phone?: ?string, notes?: ?string, client_reference?: ?string}  $input
     */
    public function create(User $tourist, Business $business, array $input): Booking
    {
        $reference = $input['client_reference'] ?? null;
        if ($reference && ($existing = $this->existing($tourist, $reference))) {
            return $existing;
        }

        try {
            $online = ($input['payment_option'] ?? 'pay_at_resort') === 'gcash';
            $booking = DB::transaction(function () use ($tourist, $business, $input, $reference, $online) {
                $priced = $this->price($business, $input);
                $this->availability->reserve($business, $priced['claims']);

                $booking = Booking::create([
                    'booking_number' => $this->bookingNumber(),
                    'client_reference' => $reference,
                    'business_id' => $business->id,
                    'user_id' => $tourist->id,
                    'customer_name' => trim($input['customer_name']),
                    'customer_email' => $tourist->email,
                    'customer_phone' => $input['customer_phone'] ?? null,
                    'booking_type' => Booking::TYPE_RESORT,
                    'status' => Booking::STATUS_PENDING,
                    'check_in_date' => $priced['check_in'],
                    'check_out_date' => $priced['check_out'],
                    'guests' => $priced['guests'],
                    'subtotal' => $priced['total'],
                    'total_amount' => $priced['total'],
                    'paid_amount' => 0,
                    'payment_status' => $online ? 'awaiting_payment' : 'unpaid',
                    'payment_option' => $online ? 'gcash' : 'pay_at_resort',
                    'payment_due_at' => $online ? now()->addMinutes(self::HOLD_MINUTES) : null,
                    'notes' => isset($input['notes']) && trim((string) $input['notes']) !== '' ? trim($input['notes']) : null,
                    'cancellation_policy' => $priced['policy'],
                ]);

                foreach ($priced['lines'] as $line) {
                    BookingItem::create([
                        'booking_id' => $booking->id,
                        'resort_offering_id' => $line['offering_id'],
                        'description' => $line['name'],
                        'category' => $line['category'],
                        'booking_mode' => $line['booking_mode'],
                        'pricing_basis' => $line['pricing_basis'],
                        'quantity' => $line['quantity'],
                        'units' => $line['units'],
                        'guests' => $line['people'],
                        'nights' => $line['nights'],
                        'allocated_quantity' => $line['allocated'],
                        'price' => $line['unit_price'],
                        'subtotal' => $line['amount'],
                        'date' => $line['start_date'],
                        'start_date' => $line['start_date'],
                        'end_date' => $line['end_date'],
                        'slot' => $line['slot'],
                        'snapshot' => $line['snapshot'],
                    ]);
                }

                $this->log($booking, null, Booking::STATUS_PENDING, $tourist, 'tourist', null);

                return $booking;
            });
        } catch (QueryException $e) {
            // A double submit raced past the first check: the UNIQUE (user, reference) kept one.
            if ($reference && ($existing = $this->existing($tourist, $reference))) {
                return $existing;
            }
            throw $e;
        }

        // A GCash reservation reaches the owner once it is paid (recordPayment).
        if ($booking->payment_option === 'pay_at_resort') {
            DB::afterCommit(fn () => $this->notifyOwner($booking, 'booking_created', 'New reservation',
                "{$booking->customer_name} reserved {$this->stayLabel($booking)} ({$booking->booking_number}). Confirm or reject it."));
        }

        return $booking->load('items', 'statusLogs');
    }

    // ------------------------------------------------------------- status changes

    public function confirm(Booking $booking, User $actor, string $actorType): Booking
    {
        return $this->transition($booking, [Booking::STATUS_PENDING], Booking::STATUS_CONFIRMED, $actor, $actorType, null, release: false,
            guard: fn (Booking $b) => $this->requirePaidIfOnline($b),
            extra: fn () => ['confirmed_at' => now()],
            notifyTourist: fn (Booking $b) => ['Reservation confirmed', "{$b->business->business_name} confirmed your reservation {$b->booking_number} for {$this->stayLabel($b)}."]);
    }

    public function reject(Booking $booking, User $actor, string $actorType, string $reason): Booking
    {
        return $this->transition($booking, [Booking::STATUS_PENDING], Booking::STATUS_REJECTED, $actor, $actorType, $this->requireReason($reason), release: true,
            guard: fn (Booking $b) => $this->requirePaidIfOnline($b),
            refundPercent: fn () => 100,
            extra: fn () => ['cancelled_at' => now(), 'cancelled_by' => $actor->id, 'cancellation_reason' => $reason],
            notifyTourist: fn (Booking $b) => ['Reservation not accepted', "{$b->business->business_name} could not accept {$b->booking_number}: {$reason}"]);
    }

    public function cancelByOwner(Booking $booking, User $actor, string $actorType, string $reason): Booking
    {
        return $this->transition($booking, [Booking::STATUS_PENDING, Booking::STATUS_CONFIRMED], Booking::STATUS_CANCELLED, $actor, $actorType, $this->requireReason($reason), release: true,
            refundPercent: fn () => 100,
            extra: fn () => ['cancelled_at' => now(), 'cancelled_by' => $actor->id, 'cancellation_reason' => $reason],
            notifyTourist: fn (Booking $b) => ['Reservation cancelled by the resort', "{$b->business->business_name} cancelled {$b->booking_number}: {$reason}"]);
    }

    /** The tourist may cancel any time before the check-in date (product owner, 2026-11-24). */
    public function cancelByTourist(Booking $booking, User $tourist, ?string $reason): Booking
    {
        if ((int) $booking->user_id !== (int) $tourist->id) {
            throw new DomainException('This is not your reservation.');
        }

        return $this->transition($booking, [Booking::STATUS_PENDING, Booking::STATUS_CONFIRMED], Booking::STATUS_CANCELLED, $tourist, 'tourist', $reason, release: true,
            guard: function (Booking $b) {
                if ($this->availability->today() >= $b->check_in_date->toDateString()) {
                    throw new DomainException('Reservations can be cancelled only before the check-in date. Please contact the resort.');
                }
            },
            refundPercent: fn (Booking $b) => ResortCancellationPolicy::refundPercent((array) $b->cancellation_policy, $b->check_in_date->toDateString(), $this->availability->today()),
            extra: fn () => ['cancelled_at' => now(), 'cancelled_by' => $tourist->id, 'cancellation_reason' => $reason],
            notifyOwner: fn (Booking $b) => ['Reservation cancelled', "{$b->customer_name} cancelled {$b->booking_number} ({$this->stayLabel($b)})."]);
    }

    public function complete(Booking $booking, User $actor, string $actorType): Booking
    {
        return $this->transition($booking, [Booking::STATUS_CONFIRMED], Booking::STATUS_COMPLETED, $actor, $actorType, null, release: false,
            guard: fn (Booking $b) => $this->requireCheckInReached($b),
            extra: fn () => ['completed_at' => now()],
            notifyTourist: fn (Booking $b) => ['Thanks for staying', "Your stay at {$b->business->business_name} is complete. You can now rate your visit."]);
    }

    public function noShow(Booking $booking, User $actor, string $actorType): Booking
    {
        return $this->transition($booking, [Booking::STATUS_CONFIRMED], Booking::STATUS_NO_SHOW, $actor, $actorType, null, release: true,
            guard: fn (Booking $b) => $this->requireCheckInReached($b),
            notifyTourist: fn (Booking $b) => ['Marked as no-show', "{$b->business->business_name} marked {$b->booking_number} as a no-show."]);
    }

    /** What the tourist may do now (for the reservation page). */
    public function touristCanCancel(Booking $booking): bool
    {
        return in_array($booking->status, [Booking::STATUS_PENDING, Booking::STATUS_CONFIRMED], true)
            && $this->availability->today() < $booking->check_in_date->toDateString();
    }

    /** @return list<string> the status changes the owner may make now */
    public function ownerActions(Booking $booking): array
    {
        if ($this->awaitingPayment($booking)) {
            return []; // the tourist is still paying with GCash
        }
        $reached = $this->availability->today() >= $booking->check_in_date?->toDateString();

        return match ($booking->status) {
            Booking::STATUS_PENDING => ['confirm', 'reject', 'cancel'],
            Booking::STATUS_CONFIRMED => $reached ? ['complete', 'no_show', 'cancel'] : ['cancel'],
            default => [],
        };
    }

    // ------------------------------------------------------------------ GCash (Stage 8)

    public function awaitingPayment(Booking $booking): bool
    {
        return $booking->payment_option === 'gcash' && $booking->payment_status === 'awaiting_payment';
    }

    /**
     * A GCash payment for a resort reservation succeeded (PayMongo webhook or the
     * return-page check; called inside their transaction, once per payment).
     * In time: the reservation is paid and goes to the owner. Too late (expired,
     * cancelled): the money is recorded and refunded in full — a payment problem
     * is never the tourist's loss.
     */
    public function recordPayment(Booking $booking, Payment $payment): void
    {
        /** @var Booking $locked */
        $locked = Booking::whereKey($booking->id)->lockForUpdate()->firstOrFail();
        if ($locked->payment_status === 'paid') {
            return;
        }
        $amount = round((float) $payment->amount, 2);

        if ($locked->status === Booking::STATUS_PENDING && $this->awaitingPayment($locked)) {
            $locked->forceFill(['payment_status' => 'paid', 'paid_amount' => $amount, 'payment_due_at' => null])->save();
            $id = $locked->id;
            DB::afterCommit(function () use ($id) {
                $b = Booking::findOrFail($id);
                $this->notifyOwner($b, 'booking_created', 'New reservation (paid with GCash)',
                    "{$b->customer_name} reserved and paid for {$this->stayLabel($b)} ({$b->booking_number}). Confirm or reject it.");
            });

            return;
        }

        // Paid after the hold ran out (or after a cancel): give it all back.
        $locked->forceFill(['payment_status' => 'paid', 'paid_amount' => $amount, 'refund_due' => $amount])->save();
        $id = $locked->id;
        DB::afterCommit(function () use ($id) {
            $b = Booking::findOrFail($id);
            $this->issueRefund($b, 'Payment arrived after the reservation expired');
            if ($b->user_id) {
                $this->inbox->notify((int) $b->user_id, 'booking_status_changed', 'Payment refunded',
                    "Your payment for {$b->booking_number} arrived after the reservation had {$this->statusWord($b->status)}. It is being refunded in full.", ['booking_id' => $b->id]);
            }
        });
    }

    /** Expire unpaid GCash reservations whose hold ran out; their units are released. */
    public function expireUnpaid(): int
    {
        $ids = Booking::where('booking_type', Booking::TYPE_RESORT)->where('payment_option', 'gcash')
            ->where('payment_status', 'awaiting_payment')->where('status', Booking::STATUS_PENDING)
            ->where('payment_due_at', '<=', now())->pluck('id');
        $expired = 0;
        foreach ($ids as $id) {
            try {
                $this->transition(Booking::findOrFail($id), [Booking::STATUS_PENDING], Booking::STATUS_EXPIRED, null, 'system', 'Not paid within '.self::HOLD_MINUTES.' minutes', release: true,
                    guard: function (Booking $b) {
                        if (! $this->awaitingPayment($b) || $b->payment_due_at?->isFuture()) {
                            throw new DomainException('Not due.'); // paid or extended meanwhile
                        }
                    },
                    notifyTourist: fn (Booking $b) => ['Reservation expired', "{$b->booking_number} was not paid within ".self::HOLD_MINUTES.' minutes, so it was released. You can reserve again.']);
                $expired++;
            } catch (DomainException) {
                // Paid or changed meanwhile: leave it.
            }
        }

        return $expired;
    }

    /**
     * Refund what is still owed (refund_due − refunded − in flight) through the
     * refund processor. Safe to call again: the processor never issues a second
     * PayMongo refund for money already refunded or in flight.
     *
     * @return string the processor's status, or 'nothing_owed' / 'no_payment'
     */
    public function issueRefund(Booking $booking, ?string $reason = null): string
    {
        $payment = $this->paymentOf($booking);
        if (! $payment) {
            return 'no_payment';
        }
        $totals = $this->refunds->refundTotals($payment);
        $owed = round((float) $booking->refund_due - $totals['succeeded'] - $totals['in_flight'], 2);
        $owed = min($owed, $totals['remaining']);
        if ($owed <= 0) {
            return 'nothing_owed';
        }

        $result = $this->refunds->initiateRefund($payment, $owed, $reason ?? "Reservation {$booking->booking_number} {$this->statusWord($booking->status)}", null, null, $booking->user_id);

        return $result['status'];
    }

    /** Retry refunds PayMongo refused (at most MAX_REFUND_ATTEMPTS failed attempts per reservation). */
    public function retryRefunds(): int
    {
        $retried = 0;
        $bookings = Booking::where('booking_type', Booking::TYPE_RESORT)->where('refund_due', '>', 0)
            ->whereIn('status', [Booking::STATUS_CANCELLED, Booking::STATUS_REJECTED, Booking::STATUS_EXPIRED])->get();
        foreach ($bookings as $booking) {
            $info = $this->refundInfo($booking);
            if ($info['status'] !== 'failed') {
                continue;
            }
            if ($info['failed_attempts'] >= self::MAX_REFUND_ATTEMPTS) {
                // Stop retrying and tell the admins once: the money must be returned by hand.
                $action = 'escalation.resort_refund_failed';
                if (! \App\Models\ActivityLog::where('action', $action)->where('model_type', Booking::class)->where('model_id', $booking->id)->exists()) {
                    \App\Models\ActivityLog::record($action,
                        "PayMongo refused the refund of ₱".number_format($info['due'] - $info['refunded'], 2)." for reservation {$booking->booking_number} ".self::MAX_REFUND_ATTEMPTS.' times. Return it manually.',
                        $booking, \App\Models\ActivityLog::TYPE_FINANCIAL);
                }

                continue;
            }
            $this->issueRefund($booking);
            $retried++;
        }

        return $retried;
    }

    /**
     * What the tourist gets back, for the pages: owed, refunded so far, in flight,
     * and a status (none · pending · refunded · failed).
     *
     * @return array{due: float, refunded: float, in_flight: float, status: string, failed_attempts: int}
     */
    public function refundInfo(Booking $booking): array
    {
        $due = round((float) $booking->refund_due, 2);
        $payment = $this->paymentOf($booking);
        if ($due <= 0 || ! $payment) {
            return ['due' => $due, 'refunded' => 0.0, 'in_flight' => 0.0, 'status' => 'none', 'failed_attempts' => 0];
        }
        $totals = $this->refunds->refundTotals($payment);
        $failed = Refund::where('payment_id', $payment->id)->where('status', 'failed')->count();
        $status = match (true) {
            $totals['succeeded'] >= $due - 0.004 => 'refunded',
            $totals['in_flight'] > 0 => 'pending',
            $failed > 0 => 'failed',
            default => 'pending',
        };

        return ['due' => $due, 'refunded' => $totals['succeeded'], 'in_flight' => $totals['in_flight'], 'status' => $status, 'failed_attempts' => $failed];
    }

    /** What cancelling now would give back (tourist page), or null when nothing was paid. */
    public function cancelRefundPreview(Booking $booking): ?array
    {
        if ($booking->payment_status !== 'paid' || (float) $booking->paid_amount <= 0 || ! $booking->cancellation_policy) {
            return null;
        }
        $percent = ResortCancellationPolicy::refundPercent((array) $booking->cancellation_policy, $booking->check_in_date->toDateString(), $this->availability->today());

        return ['percent' => $percent, 'amount' => round((float) $booking->paid_amount * $percent / 100, 2)];
    }

    private function paymentOf(Booking $booking): ?Payment
    {
        return Payment::where('payable_type', Booking::class)->where('payable_id', $booking->id)
            ->whereIn('status', ['paid', 'pending_refund', 'refunded', 'authorized'])->latest('id')->first();
    }

    private function requirePaidIfOnline(Booking $booking): void
    {
        if ($this->awaitingPayment($booking)) {
            throw new DomainException('The guest has not paid with GCash yet.');
        }
    }

    // ------------------------------------------------------------------ internals

    /**
     * @param  list<string>  $from
     * @param  callable(): array|null  $extra
     */
    private function transition(Booking $booking, array $from, string $to, ?User $actor, string $actorType, ?string $reason, bool $release,
        ?callable $guard = null, ?callable $extra = null, ?callable $notifyTourist = null, ?callable $notifyOwner = null, ?callable $refundPercent = null): Booking
    {
        if (! $booking->isResortReservation()) {
            throw new DomainException('Only resort reservations change status here.');
        }

        $updated = DB::transaction(function () use ($booking, $from, $to, $actor, $actorType, $reason, $release, $guard, $extra, $refundPercent) {
            /** @var Booking $locked */
            $locked = Booking::whereKey($booking->id)->lockForUpdate()->firstOrFail();
            if (! in_array($locked->status, $from, true)) {
                throw new DomainException("This reservation is {$this->statusWord($locked->status)}, so it can't be changed that way.");
            }
            if ($guard) {
                $guard($locked);
            }
            if ($release) {
                $this->availability->release($this->claimsOf($locked));
            }
            $previous = $locked->status;
            $changes = ['status' => $to] + ($extra ? $extra() : []);
            // Paid online: decide what goes back (refund_due) now, under the lock.
            if ($refundPercent && $locked->payment_status === 'paid' && (float) $locked->paid_amount > 0) {
                $changes['refund_due'] = round((float) $locked->paid_amount * max(0, min(100, (int) $refundPercent($locked))) / 100, 2);
            }
            if ($this->awaitingPayment($locked)) {
                $changes['payment_status'] = 'unpaid';
                $changes['payment_due_at'] = null;
            }
            $locked->forceFill($changes)->save();
            $this->log($locked, $previous, $to, $actor, $actorType, $reason);

            return $locked;
        });

        if ((float) $updated->refund_due > 0) {
            $id = $updated->id;
            DB::afterCommit(fn () => $this->issueRefund(Booking::findOrFail($id)));
        }

        $updated->loadMissing('business');
        if ($notifyTourist && $updated->user_id && $actorType !== 'tourist') {
            [$title, $message] = $notifyTourist($updated);
            DB::afterCommit(fn () => $this->inbox->notify((int) $updated->user_id, 'booking_status_changed', $title, $message, ['booking_id' => $updated->id]));
        }
        if ($notifyOwner) {
            [$title, $message] = $notifyOwner($updated);
            DB::afterCommit(fn () => $this->notifyOwner($updated, 'booking_status_changed', $title, $message));
        }

        return $updated->load('items', 'statusLogs');
    }

    /**
     * Validate a reservation request and price it.
     *
     * @return array{check_in: string, check_out: ?string, nights: int, guests: int, lines: list<array>, total: float, policy: array, claims: list<array>}
     */
    private function price(Business $business, array $input): array
    {
        $business->loadMissing('category', 'resortSetting');
        if ($business->status !== 'approved' || ! ResortClassificationService::isResort($business)) {
            throw new DomainException('This resort is not taking reservations.');
        }
        $today = $this->availability->today();
        $checkIn = (string) ($input['check_in'] ?? '');
        $checkOut = $input['check_out'] ?? null;
        $guests = (int) ($input['guests'] ?? 0);
        $lines = $input['lines'] ?? [];
        $errors = [];

        if ($checkIn < $today) {
            $errors['check_in'] = 'Choose today or a later date.';
        }
        if ($guests < 1 || $guests > self::MAX_GUESTS) {
            $errors['guests'] = 'Enter how many guests are coming.';
        }
        if (! is_array($lines) || $lines === []) {
            $errors['lines'] = 'Choose at least one cottage, room or activity.';
        }
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        $published = $business->resortOfferings()->published()->get()->keyBy('id');
        $chosen = collect($lines)->map(fn ($l) => (int) ($l['offering_id'] ?? 0));
        if ($chosen->duplicates()->isNotEmpty()) {
            throw ValidationException::withMessages(['lines' => 'Choose each offering once.']);
        }

        $overnight = $chosen->contains(fn ($id) => $published->get($id)?->booking_mode === 'overnight');
        $nights = 1;
        if ($overnight) {
            if (! $checkOut || $checkOut <= $checkIn) {
                throw ValidationException::withMessages(['check_out' => 'Choose a check-out date after the check-in date.']);
            }
            $nights = (int) CarbonImmutable::parse($checkIn)->diffInDays(CarbonImmutable::parse($checkOut));
            if ($nights > ResortAvailabilityService::MAX_NIGHTS) {
                throw ValidationException::withMessages(['check_out' => 'Stay at most '.ResortAvailabilityService::MAX_NIGHTS.' nights.']);
            }
            if ($this->availability->isClosedDay($business, $checkIn)) {
                throw ValidationException::withMessages(['check_in' => 'The resort is closed on that day; choose another check-in date.']);
            }
        } else {
            $checkOut = null;
        }

        // Required offerings and dependencies.
        foreach ($published->where('is_required', true) as $required) {
            if (! $chosen->contains($required->id)) {
                $errors['lines'] = "{$required->name} is required for every reservation.";
            }
        }

        $priced = [];
        $claims = [];
        foreach ($lines as $i => $line) {
            /** @var ResortOffering|null $o */
            $o = $published->get((int) ($line['offering_id'] ?? 0));
            $key = "lines.{$i}";
            if (! $o) {
                $errors[$key] = 'That offering is not available.';

                continue;
            }
            if ($o->requires_offering_id && ! $chosen->contains((int) $o->requires_offering_id)) {
                $partner = $published->get($o->requires_offering_id)?->name ?? 'its main offering';
                $errors[$key] = "{$o->name} can only be reserved together with {$partner}.";

                continue;
            }

            $quantity = (int) ($line['quantity'] ?? 0);
            $isUnits = $o->inventory_mode === 'units';
            $people = $isUnits ? (int) ($line['guests'] ?? 0) : $quantity;
            $minQty = max(1, (int) ($o->min_quantity ?? 1));
            $maxQty = $o->max_quantity ? (int) $o->max_quantity : (int) $o->inventory_quantity;

            if ($quantity < $minQty || $quantity > $maxQty) {
                $errors[$key] = $minQty === $maxQty ? "Choose {$minQty} for {$o->name}." : "Choose {$minQty} to {$maxQty} for {$o->name}.";

                continue;
            }
            if ($isUnits) {
                if ($people < 1) {
                    $people = $o->min_guests ? (int) $o->min_guests : 1;
                }
                if ($o->max_guests && $people > $o->max_guests * $quantity) {
                    $errors[$key] = "{$o->name} fits at most ".($o->max_guests * $quantity).' guests.';

                    continue;
                }
            } elseif ($o->max_guests && $people > $o->max_guests) {
                $errors[$key] = "{$o->name} allows at most {$o->max_guests} people per reservation.";

                continue;
            }
            if ($o->min_guests && $people < $o->min_guests) {
                $errors[$key] = "{$o->name} needs at least {$o->min_guests} people.";

                continue;
            }

            $slot = $o->booking_mode === 'time_slot' ? (string) ($line['slot'] ?? '') : null;
            if ($o->booking_mode === 'time_slot' && $slot === '') {
                $errors[$key] = "Choose a time for {$o->name}.";

                continue;
            }

            $lineNights = $o->booking_mode === 'overnight' ? $nights : 1;
            $price = (float) $o->price;
            $amount = match ($o->pricing_basis) {
                'per_person' => $price * $people * $lineNights,
                'per_unit', 'per_night' => $price * $quantity * $lineNights,
                'per_hour' => $price * (($o->duration_minutes ?: 60) / 60) * $quantity,
                default => $price, // per_booking
            };
            $lineClaims = $this->availability->claimsFor($o, $checkIn, $checkOut, $slot, $quantity, $people);
            $claims = [...$claims, ...$lineClaims];

            $priced[] = [
                'offering_id' => $o->id,
                'name' => $o->name,
                'category' => $o->category,
                'category_label' => ResortOffering::CATEGORIES[$o->category] ?? $o->category,
                'booking_mode' => $o->booking_mode,
                'pricing_basis' => $o->pricing_basis,
                'unit_price' => round($price, 2),
                'quantity' => $quantity,
                'units' => $isUnits ? $quantity : null,
                'people' => $people,
                'nights' => $lineNights,
                'slot' => $slot,
                'start_date' => $checkIn,
                'end_date' => $o->booking_mode === 'overnight' ? $checkOut : $checkIn,
                'allocated' => $lineClaims[0]['quantity'] ?? 0,
                'amount' => round($amount, 2),
                'snapshot' => [
                    'inventory_mode' => $o->inventory_mode,
                    'duration_minutes' => $o->duration_minutes,
                    'max_guests' => $o->max_guests,
                    'is_required' => (bool) $o->is_required,
                    'requires_offering_id' => $o->requires_offering_id,
                ],
            ];
        }

        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        return [
            'check_in' => $checkIn,
            'check_out' => $checkOut,
            'nights' => $overnight ? $nights : 0,
            'guests' => $guests,
            'lines' => $priced,
            'total' => round(array_sum(array_column($priced, 'amount')), 2),
            'policy' => ResortCancellationPolicy::snapshot($business),
            'claims' => $claims,
        ];
    }

    /** The claims a booking holds, rebuilt from its item snapshots. */
    private function claimsOf(Booking $booking): array
    {
        $claims = [];
        foreach ($booking->items()->whereNotNull('resort_offering_id')->with('resortOffering')->get() as $item) {
            if (! $item->resortOffering || ! $item->allocated_quantity) {
                continue;
            }
            $start = CarbonImmutable::parse($item->start_date);
            $dates = [$start->toDateString()];
            if ($item->booking_mode === 'overnight' && $item->end_date) {
                $dates = [];
                for ($d = $start; $d->lt(CarbonImmutable::parse($item->end_date)); $d = $d->addDay()) {
                    $dates[] = $d->toDateString();
                }
            }
            foreach ($dates as $date) {
                $claims[] = ['offering' => $item->resortOffering, 'date' => $date, 'slot' => (string) ($item->slot ?? ''), 'quantity' => (int) $item->allocated_quantity];
            }
        }

        return $claims;
    }

    private function existing(User $tourist, string $reference): ?Booking
    {
        return Booking::where('user_id', $tourist->id)->where('client_reference', $reference)->first()?->load('items', 'statusLogs');
    }

    private function bookingNumber(): string
    {
        do {
            $number = 'RS-'.now('Asia/Manila')->format('ymd').'-'.Str::upper(Str::random(5));
        } while (Booking::withTrashed()->where('booking_number', $number)->exists());

        return $number;
    }

    private function log(Booking $booking, ?string $from, string $to, ?User $actor, string $actorType, ?string $reason): void
    {
        BookingStatusLog::create([
            'booking_id' => $booking->id, 'from_status' => $from, 'to_status' => $to,
            'actor_id' => $actor?->id, 'actor_type' => $actor ? $actorType : 'system', 'reason' => $reason,
        ]);
    }

    private function requireReason(string $reason): string
    {
        $reason = trim($reason);
        if (mb_strlen($reason) < 3) {
            throw ValidationException::withMessages(['reason' => 'Tell the guest why (at least a few words).']);
        }

        return $reason;
    }

    private function requireCheckInReached(Booking $booking): void
    {
        if ($this->availability->today() < $booking->check_in_date->toDateString()) {
            throw new DomainException('This can be done from the check-in date.');
        }
    }

    private function notifyOwner(Booking $booking, string $type, string $title, string $message): void
    {
        $ownerId = $booking->business()->value('owner_id');
        if ($ownerId) {
            $this->inbox->notify((int) $ownerId, $type, $title, $message, ['booking_id' => $booking->id]);
        }
    }

    private function stayLabel(Booking $booking): string
    {
        $in = CarbonImmutable::parse($booking->check_in_date)->format('M j, Y');

        return $booking->check_out_date ? $in.' – '.CarbonImmutable::parse($booking->check_out_date)->format('M j, Y') : $in;
    }

    private function statusWord(string $status): string
    {
        return str_replace('_', '-', $status);
    }
}
