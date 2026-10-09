<?php

namespace App\Console\Commands;

use App\Models\BusinessDocument;
use App\Models\RiderDetail;
use App\Models\UserKyc;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

class PrivatizeVerificationDocuments extends Command
{
    protected $signature = 'verification-documents:privatize {--apply : Copy verification documents to private storage and remove public copies}';

    protected $description = 'Safely move existing verification documents off the public disk';

    public function handle(): int
    {
        $apply = (bool) $this->option('apply');
        $paths = [];

        foreach (UserKyc::query()->cursor() as $kyc) {
            foreach (['valid_id_front', 'valid_id_back', 'selfie_holding_id'] as $field) {
                if ($path = $kyc->getAttribute($field)) {
                    $paths[] = $path;
                }
            }
        }

        foreach (BusinessDocument::withTrashed()->whereNotNull('file_path')->cursor() as $document) {
            $paths[] = $document->file_path;
        }

        foreach (RiderDetail::query()->cursor() as $riderDetail) {
            foreach (['drivers_license_front', 'drivers_license_back', 'or_cr_image', 'nbi_clearance'] as $field) {
                if ($path = $riderDetail->getAttribute($field)) {
                    $paths[] = $path;
                }
            }
        }

        $moved = 0;
        $planned = 0;
        $alreadyPrivate = 0;
        $failures = 0;

        foreach (array_unique($paths) as $path) {
            if (! $this->isExpectedPath($path)) {
                $this->error("Refusing unexpected verification-document path: {$path}");
                $failures++;
                continue;
            }

            try {
                $result = $this->privatizePath($path, $apply);
                if ($result === 'moved') {
                    $moved++;
                } elseif ($result === 'planned') {
                    $planned++;
                } elseif ($result === 'private') {
                    $alreadyPrivate++;
                }
            } catch (RuntimeException $exception) {
                $this->error("Could not privatize {$path}: {$exception->getMessage()}");
                $failures++;
            }
        }

        if (! $apply) {
            $this->info('Dry run only. Re-run with --apply to move files and remove their public copies.');
        }

        $this->line("Moved: {$moved}; planned: {$planned}; already private: {$alreadyPrivate}; failures: {$failures}");

        return $failures === 0 ? self::SUCCESS : self::FAILURE;
    }

    private function isExpectedPath(string $path): bool
    {
        return ! str_starts_with($path, '/')
            && ! str_contains($path, '..')
            && (str_starts_with($path, 'ids/')
                || str_starts_with($path, 'businesses/documents/')
                || str_starts_with($path, 'riders/'));
    }

    private function privatizePath(string $path, bool $apply): string
    {
        $public = Storage::disk('public');
        $private = Storage::disk('local');
        $hasPublic = $public->exists($path);
        $hasPrivate = $private->exists($path);

        if (! $hasPublic && ! $hasPrivate) {
            throw new RuntimeException('file is missing from both public and private storage');
        }

        if ($hasPrivate) {
            if ($hasPublic && $this->streamHash($public, $path) !== $this->streamHash($private, $path)) {
                throw new RuntimeException('public and private copies differ; neither copy was changed');
            }

            if ($hasPublic && $apply) {
                $public->delete($path);
                if ($public->exists($path)) {
                    throw new RuntimeException('the public copy could not be removed');
                }
            }

            return 'private';
        }

        if (! $apply) {
            $this->line("Would move {$path}");
            return 'planned';
        }

        $source = $public->readStream($path);
        if (! is_resource($source)) {
            throw new RuntimeException('could not read the public copy');
        }

        $sourceHash = hash_init('sha256');
        try {
            hash_update_stream($sourceHash, $source);
            rewind($source);
            $written = $private->writeStream($path, $source);
        } finally {
            fclose($source);
        }

        if (! $written || ! $private->exists($path)) {
            $private->delete($path);
            throw new RuntimeException('could not write the private copy');
        }

        $privateHash = $this->streamHash($private, $path);
        if (! hash_equals(hash_final($sourceHash), $privateHash)) {
            $private->delete($path);
            throw new RuntimeException('private-copy integrity check failed');
        }

        $public->delete($path);
        if ($public->exists($path)) {
            throw new RuntimeException('the public copy could not be removed after migration');
        }

        return 'moved';
    }

    private function streamHash($disk, string $path): string
    {
        $stream = $disk->readStream($path);
        if (! is_resource($stream)) {
            throw new RuntimeException('could not read a document copy for integrity verification');
        }

        $context = hash_init('sha256');
        try {
            hash_update_stream($context, $stream);
        } finally {
            fclose($stream);
        }

        return hash_final($context);
    }
}
