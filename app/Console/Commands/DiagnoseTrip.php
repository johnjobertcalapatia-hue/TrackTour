<?php

namespace App\Console\Commands;

use App\Models\Delivery;
use App\Models\Order;
use App\Services\TripPathDiagnostics;
use Illuminate\Console\Command;

/**
 * Operations view of TripPathDiagnostics: the trip's canonical path, what is
 * wrong, and (with --fix) the same safe re-syncs the rider and the Tourism
 * Office can apply. Step resets need a person and a reason: use the admin
 * Live Deliveries page.
 */
class DiagnoseTrip extends Command
{
    protected $signature = 'trips:diagnose
        {ref : Order number (e.g. TT-04544) or delivery id}
        {--fix : Apply the safe fixes (default: report only)}';

    protected $description = 'Show a food trip\'s canonical path and fix derived-state mismatches';

    public function handle(TripPathDiagnostics $diagnostics): int
    {
        $ref = (string) $this->argument('ref');
        $delivery = ctype_digit($ref)
            ? Delivery::find((int) $ref)
            : Delivery::where('order_id', Order::where('order_number', $ref)->value('id'))->first();

        if (! $delivery) {
            $this->error("No delivery found for {$ref}.");

            return self::FAILURE;
        }

        $result = $diagnostics->diagnose($delivery, (bool) $this->option('fix'));

        $this->line("Order {$result['order_number']} · delivery #{$result['delivery_id']} · status {$result['status']}");
        $marks = ['done' => '✓', 'current' => '▶', 'todo' => '·', 'cancelled' => '✗'];
        foreach ($result['path'] as $step) {
            $this->line('  '.($marks[$step['state']] ?? '?').' '.$step['label']);
        }
        $this->line('Next: '.$result['next_step']);

        foreach ($result['findings'] as $f) {
            $line = "[{$f['kind']}/{$f['status']}] {$f['title']}: {$f['message']}";
            in_array($f['status'], ['ok', 'fixed'], true) ? $this->info($line) : $this->warn($line);
        }
        foreach ($result['resets'] as $r) {
            $this->line("Reset available (Tourism Office): {$r['label']}");
        }
        if (! $this->option('fix') && collect($result['findings'])->contains(fn ($f) => $f['kind'] === TripPathDiagnostics::FIX && $f['status'] !== 'fixed')) {
            $this->warn('Re-run with --fix to apply the safe fixes.');
        }

        return self::SUCCESS;
    }
}
