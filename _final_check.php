@start
MYSQL_PWD="";
$pdo = new PDO("mysql:host=127.0.0.1;dbname=track_tour_db;charset=utf8mb4","root","");
foreach (["pickup_actual_latitude","pickup_actual_longitude","pickup_actual_at","delivery_confirmed_at","delivery_confirmed_by"] as $c) {
  $st = $pdo->query("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='track_tour_db' AND TABLE_NAME='deliveries' AND COLUMN_NAME='$c'")->fetchColumn();
  echo "deliveries.$c  =>  ".($st?"PRESENT":"MISSING")."\n";
}
foreach (["delivery_rating"] as $c) {
  $st = $pdo->query("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='track_tour_db' AND TABLE_NAME='orders' AND COLUMN_NAME='$c'")->fetchColumn();
  echo "orders.$c      =>  ".($st?"PRESENT":"MISSING")."\n";
}
echo "\n-- migrations recorded for batch 000006 --\n";
foreach ($pdo->query("SELECT migration,batch FROM migrations WHERE migration LIKE '%000006%' ORDER BY batch,migration") as $r) { echo "  batch {$r['batch']}  {$r['migration']}\n"; }
