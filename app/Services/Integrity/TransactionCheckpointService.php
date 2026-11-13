<?php

namespace App\Services\Integrity;

use App\Models\ActivityLog;
use App\Models\TransactionBlueprint;
use App\Models\TransactionCheckpoint;
use App\Models\TransactionCheckpointEntry;
use App\Models\TransactionEvent;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * Signed checkpoints (plan §3.3). A hash chain kept only in MySQL can be
 * recomputed end-to-end by someone who can write the database, so every
 * checkpoint pins the current head of each changed chain, links to the
 * previous checkpoint (root chain), is signed with HMAC-SHA256 using a key
 * kept outside the database, and is exported to file storage as an
 * independent copy. A rewritten history then no longer matches its signed
 * checkpoint.
 */
class TransactionCheckpointService
{
    /** Create a checkpoint for every chain that changed since the last one. */
    public function create(): ?TransactionCheckpoint
    {
        [$keyId, $key] = $this->signingKey(); // throws in production without a dedicated key

        return DB::transaction(function () use ($keyId, $key) {
            $previous = TransactionCheckpoint::orderByDesc('sequence')->lockForUpdate()->first();

            $blueprints = TransactionBlueprint::query()
                ->where('event_count', '>', 0)
                ->whereRaw('event_count > COALESCE((SELECT MAX(e.event_count) FROM transaction_checkpoint_entries e WHERE e.blueprint_id = transaction_blueprints.id), 0)')
                ->orderBy('id')
                ->get();

            $entries = [];
            foreach ($blueprints as $blueprint) {
                // Pin the head stored in the event table, and only for an intact chain.
                $head = TransactionEvent::where('blueprint_id', $blueprint->id)->where('sequence', $blueprint->event_count)->first();
                if (! $head || ! $this->chainIntact($blueprint)) {
                    ActivityLog::record('integrity.checkpoint_skipped', "Transaction chain for order #{$blueprint->order_id} is not intact; it was left out of the checkpoint.", $blueprint, ActivityLog::TYPE_SECURITY);

                    continue;
                }
                $entries[] = ['blueprint_id' => $blueprint->id, 'event_count' => $blueprint->event_count, 'head_hash' => $head->current_hash];
            }
            if ($entries === []) {
                return null;
            }

            $sequence = ($previous?->sequence ?? 0) + 1;
            $previousRoot = $previous?->root_hash ?? TransactionLedger::GENESIS;
            $createdAtMs = (int) floor(microtime(true) * 1000);
            $root = self::root($previousRoot, $sequence, $createdAtMs, $entries);
            $signature = hash_hmac('sha256', $root, $key);
            $path = trim(config('integrity.export_dir', 'integrity/checkpoints'), '/')."/{$sequence}.json";

            $checkpoint = TransactionCheckpoint::create([
                'sequence' => $sequence,
                'entries_count' => count($entries),
                'previous_root' => $previousRoot,
                'root_hash' => $root,
                'signature' => $signature,
                'key_id' => $keyId,
                'created_at_ms' => $createdAtMs,
                'export_path' => $path,
            ]);
            foreach ($entries as $entry) {
                TransactionCheckpointEntry::create($entry + ['checkpoint_id' => $checkpoint->id]);
            }

            Storage::disk(config('integrity.export_disk', 'local'))->put($path, json_encode([
                'sequence' => $sequence,
                'previous_root' => $previousRoot,
                'root_hash' => $root,
                'signature' => $signature,
                'key_id' => $keyId,
                'created_at_ms' => $createdAtMs,
                'entries' => $entries,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

            return $checkpoint;
        });
    }

    /**
     * Verify one checkpoint: its root recomputes from its entries and the
     * previous root, the signature matches, and the exported copy agrees.
     *
     * @return array{ok: bool, problems: list<string>}
     */
    public function verify(TransactionCheckpoint $checkpoint): array
    {
        $problems = [];
        $entries = $checkpoint->entries()->get()
            ->map(fn (TransactionCheckpointEntry $e) => ['blueprint_id' => $e->blueprint_id, 'event_count' => $e->event_count, 'head_hash' => $e->head_hash])
            ->all();

        $previous = TransactionCheckpoint::where('sequence', $checkpoint->sequence - 1)->first();
        $expectedPrevious = $previous?->root_hash ?? TransactionLedger::GENESIS;
        if ($checkpoint->previous_root !== $expectedPrevious) {
            $problems[] = 'It does not link to the previous checkpoint.';
        }
        if (count($entries) !== $checkpoint->entries_count) {
            $problems[] = 'Its entry count changed.';
        }
        $root = self::root($checkpoint->previous_root, $checkpoint->sequence, $checkpoint->created_at_ms, $entries);
        if (! hash_equals($checkpoint->root_hash, $root)) {
            $problems[] = 'Its entries no longer produce its root hash.';
        }
        $key = $this->verificationKey((string) ($checkpoint->key_id ?? 'derived'));
        if ($key === null) {
            $problems[] = "The key '{$checkpoint->key_id}' that signed it is not configured (add it to TRANSACTION_CHECKPOINT_OLD_KEYS).";
        } elseif (! hash_equals(hash_hmac('sha256', $checkpoint->root_hash, $key), $checkpoint->signature)) {
            $problems[] = 'Its signature is not valid.';
        }

        $disk = Storage::disk(config('integrity.export_disk', 'local'));
        if (! $checkpoint->export_path || ! $disk->exists($checkpoint->export_path)) {
            $problems[] = 'Its exported copy is missing.';
        } else {
            $copy = json_decode((string) $disk->get($checkpoint->export_path), true) ?: [];
            if (($copy['root_hash'] ?? null) !== $checkpoint->root_hash
                || ($copy['signature'] ?? null) !== $checkpoint->signature
                || CanonicalJson::encode($copy['entries'] ?? []) !== CanonicalJson::encode($entries)) {
                $problems[] = 'The database checkpoint differs from its exported copy.';
            }
        }

        return ['ok' => $problems === [], 'problems' => $problems];
    }

    public static function root(string $previousRoot, int $sequence, int $createdAtMs, array $entries): string
    {
        return hash('sha256', $previousRoot."\n".CanonicalJson::encode([
            'sequence' => $sequence,
            'created_at_ms' => $createdAtMs,
            'entries' => array_values($entries),
        ]));
    }

    /**
     * The current signing key and its id. Production must have a dedicated
     * key: it never falls back to anything derived from APP_KEY.
     *
     * @return array{0: string, 1: string}
     */
    public function signingKey(): array
    {
        $key = (string) config('integrity.checkpoint_key');
        if ($key !== '') {
            if ($key === (string) config('app.key')) {
                throw new RuntimeException('TRANSACTION_CHECKPOINT_KEY must not equal APP_KEY.');
            }

            return [(string) config('integrity.checkpoint_key_id', 'k1'), $key];
        }
        if (app()->environment('production')) {
            throw new RuntimeException('Set a dedicated TRANSACTION_CHECKPOINT_KEY (php artisan integrity:key) before signing checkpoints in production.');
        }

        return ['derived', $this->derivedKey()];
    }

    /** Key for a stored key id: current, retired (old keys) or the local derived key. */
    public function verificationKey(string $keyId): ?string
    {
        $current = (string) config('integrity.checkpoint_key');
        if ($current !== '' && $keyId === (string) config('integrity.checkpoint_key_id', 'k1')) {
            return $current;
        }
        foreach (array_filter(array_map('trim', explode(',', (string) config('integrity.old_keys', '')))) as $pair) {
            [$id, $value] = array_pad(explode(':', $pair, 2), 2, '');
            if ($id === $keyId && $value !== '') {
                return $value;
            }
        }

        return $keyId === 'derived' ? $this->derivedKey() : null;
    }

    private function derivedKey(): string
    {
        return hash_hmac('sha256', 'tracktour-transaction-checkpoints', (string) config('app.key'));
    }

    private function chainIntact(TransactionBlueprint $blueprint): bool
    {
        $previous = TransactionLedger::GENESIS;
        $expected = 1;
        foreach (TransactionEvent::where('blueprint_id', $blueprint->id)->orderBy('sequence')->cursor() as $event) {
            if ($event->sequence !== $expected++ || $event->previous_hash !== $previous
                || ! hash_equals($event->current_hash, TransactionLedger::hashOf($event, $blueprint->blueprint_uid))) {
                return false;
            }
            $previous = $event->current_hash;
        }

        return $expected - 1 === $blueprint->event_count && $previous === $blueprint->current_hash;
    }
}
