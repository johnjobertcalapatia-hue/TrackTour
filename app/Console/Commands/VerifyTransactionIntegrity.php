<?php

namespace App\Console\Commands;

use App\Models\Order;
use App\Models\TransactionBlueprint;
use App\Services\Integrity\TransactionIntegrityService;
use Illuminate\Console\Command;

class VerifyTransactionIntegrity extends Command
{
    protected $signature = 'integrity:verify {--order= : Order number or id} {--hours=48 : Histories changed in the last N hours} {--all : Every history}';

    protected $description = 'Verify transaction histories (hash chain, signed checkpoint, live records)';

    public function handle(TransactionIntegrityService $integrity): int
    {
        if ($ref = $this->option('order')) {
            $order = Order::withTrashed()->where('order_number', $ref)->orWhere('id', $ref)->first();
            if (! $order) {
                $this->error('Order not found.');

                return self::FAILURE;
            }
            $this->report([$integrity->verifyOrder($order, 'manual')]);

            return self::SUCCESS;
        }

        $results = [];
        TransactionBlueprint::query()
            ->when(! $this->option('all'), fn ($q) => $q->where('updated_at', '>=', now()->subHours((int) $this->option('hours'))))
            ->orderBy('id')
            ->chunkById(200, function ($blueprints) use ($integrity, &$results) {
                foreach ($blueprints as $blueprint) {
                    $results[] = $integrity->verify($blueprint, 'scheduled');
                }
            });
        $this->report($results);

        return self::SUCCESS;
    }

    private function report(array $results): void
    {
        $counts = collect($results)->countBy('result');
        $this->info(sprintf('Verified %d: %d pass, %d flag, %d block.', count($results), $counts['pass'] ?? 0, $counts['flag'] ?? 0, $counts['block'] ?? 0));
        foreach ($results as $r) {
            if ($r['result'] === 'pass') {
                continue;
            }
            $failed = collect($r['checks'])->where('ok', false)->map(fn ($c) => "{$c['label']}: {$c['detail']}")->implode(' | ');
            $this->line(strtoupper($r['result']).' order #'.($r['blueprint']?->order_id ?? '?').' — '.$failed);
        }
    }
}
