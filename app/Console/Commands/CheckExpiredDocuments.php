<?php

namespace App\Console\Commands;

use App\Models\Business;
use Illuminate\Console\Command;

class CheckExpiredDocuments extends Command
{
    protected $signature = 'documents:check-expired';

    protected $description = 'Suspend businesses with expired documents and reinstate those that have renewed';

    public function handle(): int
    {
        $now = now()->startOfDay();

        $this->suspendExpired($now);
        $this->reinstateRenewed($now);

        return self::SUCCESS;
    }

    private function suspendExpired($now): void
    {
        $businesses = Business::where('status', 'approved')
            ->with('documents.requiredDocument')
            ->get();

        $suspended = 0;

        foreach ($businesses as $business) {
            $expirableDocs = $business->documents->filter(
                fn($d) => $d->requiredDocument?->is_expirable
            );

            $grouped = $expirableDocs->groupBy('required_document_id');
            $hasExpired = false;

            foreach ($grouped as $docs) {
                $hasValid = $docs->contains(
                    fn($d) => $d->expiration_date && $d->expiration_date >= $now
                );
                if (!$hasValid) {
                    $hasExpired = true;
                    break;
                }
            }

            if ($hasExpired) {
                $business->update(['status' => 'suspended']);
                $business->statusLogs()->create([
                    'status' => 'suspended',
                    'remarks' => 'Business suspended due to expired document(s).',
                ]);
                $suspended++;
            }
        }

        if ($suspended > 0) {
            $this->info("Suspended {$suspended} business(es) with expired documents.");
        } else {
            $this->info('No businesses with expired documents found.');
        }
    }

    private function reinstateRenewed($now): void
    {
        $businesses = Business::where('status', 'suspended')
            ->with('documents.requiredDocument')
            ->get();

        $reinstated = 0;

        foreach ($businesses as $business) {
            $expirableDocs = $business->documents->filter(
                fn($d) => $d->requiredDocument?->is_expirable
            );

            $grouped = $expirableDocs->groupBy('required_document_id');

            if ($grouped->isEmpty()) {
                continue;
            }

            $allValid = true;

            foreach ($grouped as $docs) {
                $hasValid = $docs->contains(
                    fn($d) => $d->expiration_date && $d->expiration_date >= $now
                );
                if (!$hasValid) {
                    $allValid = false;
                    break;
                }
            }

            if ($allValid) {
                $business->update(['status' => 'approved']);
                $business->statusLogs()->create([
                    'status' => 'approved',
                    'remarks' => 'Business reinstated after document renewal.',
                ]);
                $reinstated++;
            }
        }

        if ($reinstated > 0) {
            $this->info("Reinstated {$reinstated} business(es) with renewed documents.");
        }
    }
}
