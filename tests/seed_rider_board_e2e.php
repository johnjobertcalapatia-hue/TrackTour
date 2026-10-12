<?php

/**
 * Seed / teardown helper for the Rider Order Board browser E2E.
 *
 * Standalone (no PHPUnit): bootstraps Laravel, then creates an idempotent
 * fixture so two real riders can both discover ONE open delivery on the board
 * and race to accept it in a live browser.
 *
 *   php tests/seed_rider_board_e2e.php            # (re)create the fixture
 *   php tests/seed_rider_board_e2e.php --clean    # remove the fixture
 *   php tests/seed_rider_board_e2e.php --verify   # assert integrity, print JSON
 *
 * The fixture is a "cash" (COD) delivery parked at `waiting` with a pending
 * BookingDispatchLog offer for BOTH riders, both placed near the restaurant.
 * Prints a single line prefixed `SEED_JSON:` for the Selenium driver to parse.
 */

require __DIR__ . '/../vendor/autoload.php';

$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\CodPurchase;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

const E2E_OWNER_EMAIL = 'e2e-board-owner@example.com';
const E2E_RIDER_A_EMAIL = 'e2e-board-rider-a@example.com';
const E2E_RIDER_B_EMAIL = 'e2e-board-rider-b@example.com';
const E2E_BUSINESS_NAME = 'E2E Board Restaurant';
const E2E_ORDER_NUMBER = 'TT-E2E-BOARD';
const E2E_PASSWORD = 'Password123!';
const BUSINESS_LAT = 12.865;
const BUSINESS_LNG = 121.452;

function emit(string $type, array $payload = []): void
{
    echo 'SEED_JSON:' . json_encode(['type' => $type] + $payload) . PHP_EOL;
}

function clean(): void
{
    $orderIds = Order::where('order_number', E2E_ORDER_NUMBER)->pluck('id');
    $deliveryIds = Delivery::whereIn('order_id', $orderIds)->pluck('id');

    BookingDispatchLog::whereIn('delivery_id', $deliveryIds)->delete();
    Delivery::whereIn('order_id', $orderIds)->delete();
    OrderItem::whereIn('order_id', $orderIds)->delete();
    Order::whereIn('id', $orderIds)->delete();

    $riderIds = User::whereIn('email', [E2E_RIDER_A_EMAIL, E2E_RIDER_B_EMAIL])->pluck('id');
    RiderLocation::whereIn('rider_id', $riderIds)->delete();
    RiderDetail::whereIn('user_id', $riderIds)->delete();
    User::whereIn('id', $riderIds)->delete();

    $businessIds = Business::where('business_name', E2E_BUSINESS_NAME)->pluck('id');
    Business::whereIn('id', $businessIds)->delete();
    User::where('email', E2E_OWNER_EMAIL)->delete();
}

function makeRider(string $email, string $riderStatus = 'available'): User
{
    $rider = User::create([
        'email' => $email,
        'password' => Hash::make(E2E_PASSWORD),
        'role' => 'rider',
        'account_status' => 'approved',
        'email_verified_at' => now(),
        'rider_status' => $riderStatus,
        'current_service' => 'food',
    ]);

    RiderDetail::create([
        'user_id' => $rider->id,
        'rider_status' => $riderStatus,
        'current_service' => 'food',
    ]);

    RiderLocation::create([
        'rider_id' => $rider->id,
        'latitude' => BUSINESS_LAT,
        'longitude' => BUSINESS_LNG,
        'recorded_at' => now(),
    ]);

    return $rider;
}

function seed(): void
{
    clean();

    $category = BusinessCategory::firstOrCreate(['name' => 'Restaurant']);
    $municipality = Municipality::firstOrCreate(
        ['name' => 'Bansud'],
        ['district' => '1st', 'province' => 'Oriental Mindoro', 'latitude' => 12.5, 'longitude' => 121.3]
    );

    $owner = User::create([
        'email' => E2E_OWNER_EMAIL,
        'password' => Hash::make(E2E_PASSWORD),
        'role' => 'business_owner',
        'account_status' => 'approved',
    ]);

    $business = Business::create([
        'owner_id' => $owner->id,
        'business_category_id' => $category->id,
        'municipality_id' => $municipality->id,
        'business_name' => E2E_BUSINESS_NAME,
        'status' => 'approved',
        'force_closed' => false,
        'address' => '123 Poblacion, Bansud',
        'latitude' => BUSINESS_LAT,
        'longitude' => BUSINESS_LNG,
    ]);

    $riderA = makeRider(E2E_RIDER_A_EMAIL);
    $riderB = makeRider(E2E_RIDER_B_EMAIL);

    $order = Order::create([
        'order_number' => E2E_ORDER_NUMBER,
        'business_id' => $business->id,
        'customer_name' => 'E2E Tourist',
        'customer_email' => 'e2e-board-tourist@example.com',
        'customer_phone' => '09171234567',
        'order_type' => 'delivery',
        'payment_method' => 'cash',
        'payment_status' => 'pending',
        'status' => 'waiting_restaurant',
        'subtotal' => 300,
        'delivery_fee' => 40,
        'rider_tip' => 0,
        'system_fee' => 0,
        'rider_financed_amount' => 300,
        'total' => 340,
        'delivery_latitude' => 12.860,
        'delivery_longitude' => 121.450,
        'delivery_address' => '456 Test St, Bansud',
    ]);

    OrderItem::create([
        'order_id' => $order->id,
        'business_id' => $business->id,
        'product_name' => 'Chicken Adobo',
        'quantity' => 2,
        'unit_price' => 150,
        'subtotal' => 300,
    ]);

    $delivery = Delivery::create([
        'order_id' => $order->id,
        'rider_id' => null,
        'status' => 'waiting',
        'rider_commission' => 39.20,
        'delivery_fee' => 40,
        'estimated_duration_minutes' => 12,
        'pickup_address' => E2E_BUSINESS_NAME,
        'delivery_address' => $order->delivery_address,
        'pickup_latitude' => BUSINESS_LAT,
        'pickup_longitude' => BUSINESS_LNG,
        'delivery_latitude' => 12.860,
        'delivery_longitude' => 121.450,
    ]);

    foreach ([$riderA, $riderB] as $rider) {
        BookingDispatchLog::create([
            'delivery_id' => $delivery->id,
            'rider_id' => $rider->id,
            'distance_km' => 0.4,
            'response' => 'pending',
            'dispatched_at' => now(),
        ]);
    }

    emit('seeded', [
        'base_url_hint' => 'http://localhost:3000',
        'password' => E2E_PASSWORD,
        'rider_a_email' => E2E_RIDER_A_EMAIL,
        'rider_b_email' => E2E_RIDER_B_EMAIL,
        'business_id' => $business->id,
        'order_id' => $order->id,
        'order_number' => E2E_ORDER_NUMBER,
        'delivery_id' => $delivery->id,
        'rider_a_id' => $riderA->id,
        'rider_b_id' => $riderB->id,
    ]);
}

function verify(): void
{
    $delivery = Delivery::whereHas('order', fn ($q) => $q->where('order_number', E2E_ORDER_NUMBER))->first();

    if (! $delivery) {
        emit('verify', ['ok' => false, 'error' => 'fixture delivery not found']);
        exit(1);
    }

    $assignedCount = Delivery::where('id', $delivery->id)->whereNotNull('rider_id')->count();
    $acceptedLogs = BookingDispatchLog::where('delivery_id', $delivery->id)->where('response', 'accepted')->count();
    $pendingLogs = BookingDispatchLog::where('delivery_id', $delivery->id)->where('response', 'pending')->count();
    $cancelledLogs = BookingDispatchLog::where('delivery_id', $delivery->id)->where('response', 'cancelled')->count();

    // No duplicate assignment: exactly one rider on the delivery, exactly one
    // accepted log, no other delivery bound to the same order.
    $deliveriesForOrder = Delivery::where('order_id', $delivery->order_id)->count();

    // Credit-free COD: acceptance initializes exactly one per-restaurant
    // purchasing-cash stop and the sum reconciles to the settlement base.
    $order = Order::find($delivery->order_id);
    $purchaseCount = CodPurchase::where('delivery_id', $delivery->id)->count();
    $purchaseSum = (float) CodPurchase::where('delivery_id', $delivery->id)->sum('purchase_amount');
    $codBase = (float) ($order?->rider_financed_amount ?? 0);
    $codOk = $purchaseCount === 1 && abs($purchaseSum - $codBase) < 0.01;

    $ok = $assignedCount === 1
        && $acceptedLogs === 1
        && $pendingLogs === 0
        && $deliveriesForOrder === 1
        && $codOk;

    emit('verify', [
        'ok' => $ok,
        'delivery_id' => $delivery->id,
        'assigned_rider_id' => $delivery->rider_id,
        'delivery_status' => $delivery->status,
        'assigned_count' => $assignedCount,
        'accepted_logs' => $acceptedLogs,
        'pending_logs' => $pendingLogs,
        'cancelled_logs' => $cancelledLogs,
        'deliveries_for_order' => $deliveriesForOrder,
        'cod_purchase_count' => $purchaseCount,
        'cod_purchase_sum' => $purchaseSum,
        'cod_settlement_base' => $codBase,
    ]);

    exit($ok ? 0 : 1);
}

$arg = $argv[1] ?? null;

if ($arg === '--clean') {
    clean();
    emit('cleaned');
    exit(0);
}

if ($arg === '--verify') {
    verify();
    exit(0);
}

seed();
exit(0);
