<?php

require __DIR__ . '/vendor/autoload.php';

$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

echo "CONNECTION: " . config('database.default') . "\n";
echo "DBNAME:     " . config('database.connections.' . config('database.default') . '.database') . "\n\n";

echo "== deliveries columns ==" . PHP_EOL;
$cols = Schema::getColumnListing('deliveries');
foreach ($cols as $c) {
    if (preg_match('/pickup|confirmed|delivered|rating|actual/', $c)) {
        $type = Schema::getColumnType('deliveries', $c);
        echo "  $c ($type)\n";
    }
}

echo "\n== orders columns ==" . PHP_EOL;
$cols = Schema::getColumnListing('orders');
foreach ($cols as $c) {
    if (preg_match('/rating/', $c)) {
        $type = Schema::getColumnType('orders', $c);
        echo "  $c ($type)\n";
    }
}

echo "\n== deliveries rows ==" . PHP_EOL;
echo '  total = ' . DB::table('deliveries')->count() . "\n";
echo '  status IN (delivered, completed) = ' . DB::table('deliveries')->whereIn('status', ['delivered', 'completed'])->count() . "\n";
echo '  is_cod = ' . DB::table('deliveries')->where('is_cod', 1)->count() . "\n";
echo '  order_type food (JOIN orders) = ' . DB::table('deliveries')->join('orders', 'deliveries.order_id', '=', 'orders.id')->where('orders.order_type', 'food')->count() . "\n";

echo "\n== orders rows ==" . PHP_EOL;
echo '  total = ' . DB::table('orders')->count() . "\n";
echo '  food total = ' . DB::table('orders')->where('order_type', 'food')->count() . "\n";
echo '  food status delivered = ' . DB::table('orders')->where('order_type', 'food')->where('status', 'delivered')->count() . "\n";
echo '  food status completed = ' . DB::table('orders')->where('order_type', 'food')->where('status', 'completed')->count() . "\n";

echo "\n== migrations applied (tail) ==" . PHP_EOL;
foreach (DB::table('migrations')->orderBy('batch')->orderBy('migration')->get() as $row) {
    if (str_contains($row->migration, '2026_09_24')) {
        echo "  batch {$row->batch}: {$row->migration}\n";
    }
}
