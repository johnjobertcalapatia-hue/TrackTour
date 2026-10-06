<?php

$d = __DIR__;
$env = [];
foreach (file($d . '/.env') as $line) {
    $line = trim($line);
    if ($line === '' || str_starts_with($line, '#')) continue;
    [$k, $v] = array_pad(explode('=', $line, 2), 2, '');
    $env[trim($k)] = trim($v);
}

$db = $env['DB_DATABASE'] ?? 'track_tour_db';
$user = $env['DB_USERNAME'] ?? 'root';
$pass = $env['DB_PASSWORD'] ?? '';
$pdo = new PDO('mysql:host=' . ($env['DB_HOST'] ?? '127.0.0.1') . ';port=' . ($env['DB_PORT'] ?? '3306') . ';dbname=' . $db . ';charset=utf8mb4', $user, $pass);

echo "DB = $db\n\n";

$cols = $pdo->query("SHOW COLUMNS FROM deliveries")->fetchAll(PDO::FETCH_ASSOC);
$wanted = ['pickup_actual_latitude','pickup_actual_longitude','pickup_actual_at','delivery_confirmed_at','delivery_confirmed_by','delivered_at'];
echo "-- deliveries relevant columns --\n";
foreach ($cols as $c) {
    if (in_array($c['Field'], $wanted, true)) {
        echo "  {$c['Field']}  {$c['Type']}  {$c['Null']}  default=" . var_export($c['Default'], true) . "\n";
    }
}

$cols = $pdo->query("SHOW COLUMNS FROM orders")->fetchAll(PDO::FETCH_ASSOC);
$wanted = ['delivery_rating','rating','rating_tags'];
echo "\n-- orders relevant columns --\n";
foreach ($cols as $c) {
    if (in_array($c['Field'], $wanted, true)) {
        echo "  {$c['Field']}  {$c['Type']}  {$c['Null']}  default=" . var_export($c['Default'], true) . "\n";
    }
}

$mig = $pdo->query("SELECT migration, batch FROM migrations WHERE migration LIKE '%delivery_confirmation%' OR migration LIKE '%actual_pickup%' OR migration LIKE '%pickup_actual%' ORDER BY batch, migration")->fetchAll(PDO::FETCH_ASSOC);
echo "\n-- migrations rows --\n";
foreach ($mig as $m) {
    echo "  batch {$m['batch']}  {$m['migration']}\n";
}
if (count($mig) === 0) echo "  (none)\n";

echo "\n-- deliveries row counts --\n";
$d = $pdo->query("SELECT COUNT(*) AS c FROM deliveries")->fetch(PDO::FETCH_ASSOC);
echo "  deliveries total = {$d['c']}\n";
$d = $pdo->query("SELECT COUNT(*) AS c FROM orders")->fetch(PDO::FETCH_ASSOC);
echo "  orders total = {$d['c']}\n";
