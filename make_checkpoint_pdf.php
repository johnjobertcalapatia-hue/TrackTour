<?php

require __DIR__.'/vendor/autoload.php';
$app = require_once __DIR__.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$htmlPath = __DIR__.'/ride_checkpoint.html';
$outPath = __DIR__.'/Ride-Hailing-Fix-Checkpoint.pdf';

if (! is_file($htmlPath)) {
    echo "MISSING HTML: {$htmlPath}\n";
    exit(1);
}

$html = file_get_contents($htmlPath);

$dompdf = $app->make('dompdf.wrapper');
$dompdf->setPaper('A4', 'portrait');
$dompdf->loadHTML($html, 'UTF-8');
$dompdf->render();

$dompdf->save($outPath);

if (! is_file($outPath)) {
    echo "FAILED to write PDF\n";
    exit(1);
}

$size = filesize($outPath);
$head = file_get_contents($outPath, false, null, 0, 5);
$pages = $dompdf->getDomPDF()->getCanvas()->get_page_count();

echo "PDF written: {$outPath}\n";
echo 'bytes: '.$size."\n";
echo 'header: '.trim($head)."\n";
echo 'pages: '.$pages."\n";
