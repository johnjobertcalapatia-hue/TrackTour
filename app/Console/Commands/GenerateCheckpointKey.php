<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

/**
 * Prints a new random checkpoint signing key. It never writes .env: the
 * owner stores it in the environment / secret store and backs it up.
 */
class GenerateCheckpointKey extends Command
{
    protected $signature = 'integrity:key {--id= : Key id stored with each checkpoint (default k<date>)}';

    protected $description = 'Print a new random TRANSACTION_CHECKPOINT_KEY (does not modify .env)';

    public function handle(): int
    {
        $id = $this->option('id') ?: 'k'.now()->format('Ymd');
        $this->line('TRANSACTION_CHECKPOINT_KEY_ID='.$id);
        $this->line('TRANSACTION_CHECKPOINT_KEY=base64:'.base64_encode(random_bytes(32)));
        $this->newLine();
        $this->comment('Rotating? Move the previous id:key into TRANSACTION_CHECKPOINT_OLD_KEYS so older checkpoints still verify.');

        return self::SUCCESS;
    }
}
