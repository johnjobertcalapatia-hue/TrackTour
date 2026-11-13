<?php

namespace App\Console\Commands;

use App\Services\Integrity\TransactionCheckpointService;
use Illuminate\Console\Command;

class CreateTransactionCheckpoint extends Command
{
    protected $signature = 'integrity:checkpoint';

    protected $description = 'Sign a checkpoint of every transaction history that changed since the last one';

    public function handle(TransactionCheckpointService $checkpoints): int
    {
        try {
            $checkpoint = $checkpoints->create();
        } catch (\RuntimeException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
        $this->info($checkpoint
            ? "Checkpoint #{$checkpoint->sequence} signed ({$checkpoint->entries_count} histories)."
            : 'Nothing changed since the last checkpoint.');

        return self::SUCCESS;
    }
}
