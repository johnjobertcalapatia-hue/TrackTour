<?php

namespace Database\Seeders;

use App\Models\Barangay;
use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\GroupCheckout;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\GroupOrderService;
use App\Services\NearestRiderService;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

/**
 * Deterministic professor COBDEMO: multi-restaurant purchasing-cash COD delivery.
 *
 * Seeded state is ready-to-demonstrate: the COD group order is ALREADY placed
 * (one canonical order, one shared delivery, one rider offer pending for the
 * nearest eligible rider = Rider A). Nothing is pre-completed:
 *
 *   Rider A accepts  →  Tourism Office issues purchasing cash
 *     → rider confirms receipt → Restaurant A Buy→Collect → Restaurant B Buy→Collect
 *     → "All food collected" → picked_up → deliver → tourist pays cash
 *     → settle-cod → completed (COD settlement 80/20)
 *
 * Money shape (with default 10% system fee):
 *   Restaurant A: Adobo Meal ₱120 + Iced Tea ₱80  = ₱200 + ₱20 fee-share = ₱220 stop
 *   Restaurant B: BBQ Sticks ₱100 + Calamansi ₱50 = ₱150 + ₱15 fee-share = ₱165 stop
 *   Σ purchases = purchasing_cash = ₱385 = order.rider_financed_amount (settlement base)
 *   Delivery fee is routing-based (rider earnings); grand total = subtotal +
 *   delivery fee + system fee, paid by the tourist in cash at drop-off.
 *
 * Accounts are deterministic and idempotent; only ONE in-flight demo order is
 * ever created (re-runs reuse the active one).
 */
class CodDemoSeeder extends Seeder
{
    private const PASSWORD = 'Demo12345!';

    private Municipality $municipality;

    private BusinessCategory $category;

    private User $owner;

    private User $tourist;

    private User $admin;

    private User $riderA;

    private User $riderB;

    private Business $restaurantA;

    private Business $restaurantB;

    public function run(): void
    {
        $this->ensureGeography();
        $this->ensureUsers();
        $this->ensureBusinesses();
        $this->ensureCandidates();

        $group = $this->ensureDemoOrder();

        $this->report($group);
    }

    private function ensureGeography(): void
    {
        $this->municipality = Municipality::firstOrCreate(
            ['name' => 'Bansud'],
            [
                'district' => '1st District',
                'province' => 'Oriental Mindoro',
                'latitude' => 12.5,
                'longitude' => 121.3,
            ]
        );

        Barangay::firstOrCreate(
            ['municipality_id' => $this->municipality->id, 'name' => 'Poblacion'],
            []
        );

        $this->category = BusinessCategory::firstOrCreate(
            ['name' => 'Restaurant'],
            ['description' => 'Food and dining establishments']
        );
    }

    private function ensureUsers(): void
    {
        $this->owner = $this->ensureUser('demo.owner@tracktour.test', 'Demo Business Owner', User::ROLE_BUSINESS_OWNER);
        $this->admin = $this->ensureUser('demo.tourism.office@tracktour.test', 'Demo Tourism Office', User::ROLE_BANSUD_TOURISM_OFFICE);

        $this->tourist = $this->ensureUser('demo.tourist@tracktour.test', 'Demo Tourist', User::ROLE_TOURIST);
        $this->tourist->profile()->firstOrCreate(
            ['user_id' => $this->tourist->id],
            ['first_name' => 'Demo', 'last_name' => 'Tourist']
        );

        $this->riderA = $this->ensureRider('demo.rider.a@tracktour.test', 'Demo Rider A', 12.51, 121.31);
        $this->riderB = $this->ensureRider('demo.rider.b@tracktour.test', 'Demo Rider B', 12.505, 121.305);
    }

    private function ensureUser(string $email, string $name, string $role): User
    {
        return User::updateOrCreate(
            ['email' => $email],
            [
                'name' => $name,
                'password' => Hash::make(self::PASSWORD),
                'role' => $role,
                'account_status' => User::ACCOUNT_STATUS_APPROVED,
                'municipality_id' => $this->municipality->id,
                'email_verified_at' => now(),
            ]
        );
    }

    private function ensureRider(string $email, string $name, float $lat, float $lng): User
    {
        $rider = $this->ensureUser($email, $name, User::ROLE_RIDER);

        RiderDetail::updateOrCreate(
            ['user_id' => $rider->id],
            [
                'rider_status' => User::RIDER_STATUS_AVAILABLE,
                'rider_status_updated_at' => now(),
                'current_service' => User::SERVICE_FOOD,
                'vehicle_type' => 'motorcycle',
                'vehicle_make' => 'Honda',
                'vehicle_model' => 'TMX 155',
                'vehicle_plate_number' => 'DMX-2026',
                'vehicle_year' => 2022,
                'license_number' => 'D12-34-567890',
                'license_expiry' => now()->addYears(2),
                'or_cr_number' => 'ORCR-2026-001',
            ]
        );

        RiderLocation::updateOrCreate(
            [
                'rider_id' => $rider->id,
                'recorded_at' => now(),
            ],
            [
                'latitude' => $lat,
                'longitude' => $lng,
                'recorded_at' => now(),
            ]
        );

        return $rider;
    }

    private function ensureBusinesses(): void
    {
        $this->restaurantA = $this->ensureRestaurant('Demo Restaurant A — Adobo & Rice', 12.51, 121.31);
        $this->restaurantB = $this->ensureRestaurant('Demo Restaurant B — Grill & Quench', 12.52, 121.32);

        $this->ensureOffering($this->restaurantA, 'Chicken Adobo Rice Meal', 120.00);
        $this->ensureOffering($this->restaurantA, 'Iced Tea (Pitcher)', 80.00);

        $this->ensureOffering($this->restaurantB, 'Pork BBQ Sticks (5 pcs)', 100.00);
        $this->ensureOffering($this->restaurantB, 'Calamansi Juice', 50.00);
    }

    private function ensureRestaurant(string $name, float $lat, float $lng): Business
    {
        $allDays = array_fill_keys(
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
            [['open' => '00:00', 'close' => '23:59']]
        );

        return Business::updateOrCreate(
            ['owner_id' => $this->owner->id, 'business_name' => $name],
            [
                'business_category_id' => $this->category->id,
                'municipality_id' => $this->municipality->id,
                'business_name' => $name,
                'business_description' => 'Deterministic professor COD purchasing-cash demo restaurant.',
                'contact_number' => '09171234567',
                'email' => $this->owner->email,
                'address' => 'Poblacion, Bansud, Oriental Mindoro',
                'latitude' => $lat,
                'longitude' => $lng,
                'opening_time' => '00:00',
                'closing_time' => '23:59',
                'business_days' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
                'business_hours' => $allDays,
                'force_closed' => false,
                'status' => 'approved',
            ]
        );
    }

    private function ensureOffering(Business $business, string $name, float $price): Offering
    {
        return Offering::updateOrCreate(
            ['business_id' => $business->id, 'name' => $name],
            [
                'price' => $price,
                'description' => "Freshly prepared {$name}",
                'is_available' => true,
                'status' => 'available',
                'type' => 'food',
                'offering_type' => 'food',
            ]
        );
    }

    private function ensureCandidates(): void
    {
        // Guard: elderly demo-created riders should not have a stale active trip.
        foreach ([$this->riderA, $this->riderB] as $rider) {
            if ($rider->deliveries()->whereIn('status', ['assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit', 'arrived_destination', 'delivered'])->exists()) {
                $this->command?->warn("Rider {$rider->email} still has an in-flight delivery; demo state assumes a clean rider.");
            }
        }
    }

    private function ensureDemoOrder(): GroupCheckout
    {
        $active = Delivery::whereHas('groupCheckout', function ($q) {
            $q->where('user_id', $this->tourist->id);
        })
            ->whereNotIn('status', ['delivered', 'completed', 'cancelled'])
            ->latest('id')
            ->first();

        if ($active) {
            $this->command?->info('Reusing the active demo delivery (nothing pre-completed):');
            $this->command?->info("  delivery #{$active->id} — status {$active->status->value}");

            if (! $this->hasPendingOffer($active)) {
                $this->resetDispatch($active);
            }

            return $active->groupCheckout;
        }

        $a1 = $this->restaurantA->offerings()->where('name', 'Chicken Adobo Rice Meal')->firstOrFail();
        $a2 = $this->restaurantA->offerings()->where('name', 'Iced Tea (Pitcher)')->firstOrFail();
        $b1 = $this->restaurantB->offerings()->where('name', 'Pork BBQ Sticks (5 pcs)')->firstOrFail();
        $b2 = $this->restaurantB->offerings()->where('name', 'Calamansi Juice')->firstOrFail();

        $groupService = app(GroupOrderService::class);

        $group = $groupService->createGroup($this->tourist, [
            'order_type' => 'delivery',
            'delivery_speed' => 'standard',
            'rider_tip' => 0,
            'delivery_latitude' => 12.515,
            'delivery_longitude' => 121.315,
            'delivery_address' => '1245 Poblacion Rd, Bansud, Oriental Mindoro',
            'customer_phone' => '09171234567',
            'payment_method' => 'cash',
            'notes' => 'Professor purchasing-cash COD demo order (deterministic seed).',
            'restaurants' => [
                ['business_id' => $this->restaurantA->id, 'items' => [
                    ['offering_id' => $a1->id, 'quantity' => 1, 'notes' => null],
                    ['offering_id' => $a2->id, 'quantity' => 1, 'notes' => null],
                ]],
                ['business_id' => $this->restaurantB->id, 'items' => [
                    ['offering_id' => $b1->id, 'quantity' => 1, 'notes' => null],
                    ['offering_id' => $b2->id, 'quantity' => 1, 'notes' => null],
                ]],
            ],
        ]);

        return $group->fresh();
    }

    private function hasPendingOffer(Delivery $delivery): bool
    {
        return BookingDispatchLog::where('delivery_id', $delivery->id)
            ->where('response', 'pending')
            ->latest('id')
            ->exists();
    }

    private function resetDispatch(Delivery $delivery): void
    {
        BookingDispatchLog::where('delivery_id', $delivery->id)
            ->whereIn('response', ['timeout', 'expired', 'declined', 'cancelled', 'rejected'])
            ->delete();

        foreach ([$this->riderA, $this->riderB] as $rider) {
            RiderLocation::where('rider_id', $rider->id)->update(['recorded_at' => now()]);
        }

        $delivery->update([
            'dispatch_status' => null,
            'dispatch_expires_at' => null,
            'dispatch_attempts' => 0,
        ]);

        app(NearestRiderService::class)->dispatchToNearest($delivery, 'food', $this->municipality->id);
    }

    private function report(GroupCheckout $group): void
    {
        $order = $group->orders()->sole();
        $delivery = $group->delivery;

        $offer = BookingDispatchLog::where('delivery_id', $delivery->id)
            ->where('response', 'pending')
            ->latest('id')
            ->first();

        $subtotal = (float) $order->subtotal;
        $systemFee = (float) $order->system_fee;
        $financed = (float) $order->rider_financed_amount;
        $deliveryFee = (float) $delivery->delivery_fee;
        $grandTotal = (float) $order->total;

        $stopA = round($subtotalA = 120.00 + 80.00, 2);
        $stopB = round(100.00 + 50.00, 2);
        $feeA = round($systemFee * ($stopA / $subtotal), 2);
        $feeB = round($systemFee * ($stopB / $subtotal), 2);

        $this->command?->info('');
        $this->command?->info('══════════════════════════════════════════════════════════');
        $this->command?->info('  CODEMO — COD PURCHASING-CASH DEMO (professor flow)');
        $this->command?->info('══════════════════════════════════════════════════════════');
        $this->command?->info('');
        $this->command?->info('Accounts (password: Demo12345!)');
        $this->command?->info('  Tourist .......... demo.tourist@tracktour.test');
        $this->command?->info('  Rider A .......... demo.rider.a@tracktour.test');
        $this->command?->info('  Rider B .......... demo.rider.b@tracktour.test');
        $this->command?->info('  Tourism Office ... demo.tourism.office@tracktour.test');
        $this->command?->info('');
        $this->command?->info('Order placed (NOT pre-completed)');
        $this->command?->info("  Group checkout  #{$group->id}  ({$group->reference_number})");
        $this->command?->info("  Canonical order  #{$order->id}  ({$order->order_number})");
        $this->command?->info("  ONE delivery     #{$delivery->id}  status={$delivery->status->value} dispatch={$delivery->dispatch_status}");
        $this->command?->info("  Pending offer    → " . ($offer ? $offer->rider->name." (rider #{$offer->rider_id})" : 'none yet'));
        $this->command?->info('');
        $this->command?->info('Money (default 10% system fee)');
        $this->command?->info("  Restaurant A items . ₱120 + ₱80    = ₱{$stopA}  (stop ≈ ₱{$stopA}+₱{$feeA} = ₱".round($stopA + $feeA, 2).')');
        $this->command?->info("  Restaurant B items . ₱100 + ₱50    = ₱{$stopB}  (stop ≈ ₱{$stopB}+₱{$feeB} = ₱".round($stopB + $feeB, 2).')');
        $this->command?->info("  Subtotal .......... ₱".number_format($subtotal, 2));
        $this->command?->info("  System fee ........ ₱".number_format($systemFee, 2));
        $this->command?->info("  Purchasing cash ... ₱".number_format($financed, 2)."  = order.rider_financed_amount (settlement base)");
        $this->command?->info("  Delivery fee ...... ₱".number_format($deliveryFee, 2)."  (rider earnings)");
        $this->command?->info("  Tourist pays cash . ₱".number_format($grandTotal, 2).'  (subtotal + fee + system fee, at drop-off)');
        $this->command?->info('');
        $this->command?->info('Next steps (in the app):');
        $this->command?->info('  1. Sign in as Rider A → accept the shared delivery');
        $this->command?->info('  2. Tourism Office → Live Deliveries → Issue Cash (₱'.number_format($financed, 2).')');
        $this->command?->info('  3. Rider A → Purchasing Cash cockpit → confirm receipt, then');
        $this->command?->info('     Restaurant A Buy→Collect · Restaurant B Buy→Collect');
        $this->command?->info('  4. "All food collected" → leave pickup → deliver');
        $this->command?->info('  5. Tourist pays ₱'.number_format($grandTotal, 2).' cash → settle-cod');
        $this->command?->info('  6. Settlement: Restaurant ₱'.number_format($financed * 0.8, 2).' (80%) · Tourism Office ₱'.number_format($financed * 0.2, 2).' (20%)');
        $this->command?->info('══════════════════════════════════════════════════════════');
    }
}