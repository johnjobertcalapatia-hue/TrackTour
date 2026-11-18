<?php

namespace App\Services;

use App\Models\SystemIncident;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Str;
use Throwable;

/**
 * Writes the system incident history. Recording must never break the request
 * that failed: every write is guarded, never re-enters itself (an error while
 * recording is not recorded again), and keeps only safe details — passwords,
 * tokens, secrets and file contents are never stored.
 */
class SystemIncidentRecorder
{
    // Whole words only ("pin" hides `pin` / `mpin`, not `shipping`).
    private const SECRET_KEYS = '/(^|[_\-])(m?pin|otp|cvv|cvc|password|passwd|pass|token|secret|authorization|cookie|signature|apikey|api_key|card_number|card)($|[_\-])/i';

    private static bool $recording = false;

    /**
     * @param  array<string, mixed>  $context
     */
    public static function record(
        string $category,
        string $code,
        string $severity,
        string $title,
        ?string $message = null,
        array $context = [],
        ?Model $subject = null,
        string $status = SystemIncident::STATUS_OPEN,
        ?string $fingerprintKey = null,
        ?User $user = null,
        bool $withActor = true,
    ): ?SystemIncident {
        if (self::$recording) {
            return null;
        }
        self::$recording = true;

        try {
            $request = app()->runningInConsole() && ! app()->runningUnitTests() ? null : request();
            $actor = $user ?? ($withActor ? self::currentUser() : null);

            return SystemIncident::create([
                'category' => $category,
                'code' => $code,
                'severity' => $severity,
                'status' => $status,
                'title' => Str::limit($title, 250, ''),
                'message' => $message !== null ? Str::limit($message, 2000) : null,
                'context' => $context ? self::sanitize($context) : null,
                'user_id' => $actor?->id,
                'ip_address' => $request?->ip(),
                'method' => $request?->method(),
                'path' => $request ? Str::limit('/'.ltrim($request->path(), '/'), 250, '') : null,
                'subject_type' => $subject ? $subject::class : null,
                'subject_id' => $subject?->getKey(),
                'fingerprint' => sha1($category.'|'.$code.'|'.($fingerprintKey ?? '')),
                'occurred_at' => now(),
            ]);
        } catch (Throwable) {
            // The history is best-effort: a failure to record never hides the
            // original problem (it is still in the application log).
            return null;
        } finally {
            self::$recording = false;
        }
    }

    /** An unexpected server error (or an upload that crashed). */
    public static function exception(Throwable $e): void
    {
        $request = app()->runningInConsole() && ! app()->runningUnitTests() ? null : request();
        $hasFiles = $request && $request->allFiles() !== [];
        $where = basename($e->getFile()).':'.$e->getLine();

        self::record(
            $hasFiles ? 'upload' : 'server',
            $hasFiles ? 'upload_failed' : 'server_error',
            'error',
            $hasFiles ? 'An upload failed on the server' : 'Server error: '.class_basename($e),
            Str::limit($e->getMessage(), 1000),
            ['exception' => $e::class, 'where' => $where, 'files' => $hasFiles ? self::fileSummary($request) : null],
            fingerprintKey: $e::class.'|'.$where,
        );
    }

    /** A rejected upload (wrong type, too large, failed to arrive). */
    public static function uploadRejected(Request $request, array $errors): void
    {
        $fileFields = array_keys(Arr::dot($request->allFiles()));
        $fileFields = array_map(fn ($k) => preg_replace('/\.\d+$/', '', $k), $fileFields);
        $failed = array_values(array_filter(array_keys($errors), fn ($field) => in_array(preg_replace('/\.\d+$/', '', $field), $fileFields, true)));
        if ($failed === []) {
            return;
        }

        self::record(
            'upload', 'upload_rejected', 'warning',
            'Upload rejected: '.implode(', ', array_map(fn ($f) => str_replace('_', ' ', $f), $failed)),
            implode(' ', array_map(fn ($f) => implode(' ', (array) $errors[$f]), $failed)),
            ['fields' => $failed, 'files' => self::fileSummary($request)],
            status: SystemIncident::STATUS_RECORDED,
            fingerprintKey: $request->path().'|'.implode(',', $failed),
        );
    }

    /** Keep a list of files without their contents (name, size, type). */
    private static function fileSummary(?Request $request): array
    {
        if (! $request) {
            return [];
        }
        $out = [];
        foreach (Arr::dot($request->allFiles()) as $field => $file) {
            if ($file instanceof \Illuminate\Http\UploadedFile) {
                $out[] = [
                    'field' => $field,
                    'name' => Str::limit($file->getClientOriginalName(), 120),
                    'size_kb' => $file->isValid() || $file->getSize() ? round(($file->getSize() ?: 0) / 1024, 1) : null,
                    'type' => $file->getClientMimeType(),
                    'upload_error' => $file->getError() ?: null,
                ];
            }
        }

        return array_slice($out, 0, 10);
    }

    private static function currentUser(): ?User
    {
        try {
            $user = auth()->user() ?? auth('sanctum')->user();

            return $user instanceof User ? $user : null;
        } catch (Throwable) {
            return null;
        }
    }

    /** Drop secrets, trim long values, cap the size. */
    private static function sanitize(array $context, int $depth = 0): array
    {
        $clean = [];
        foreach ($context as $key => $value) {
            if (is_string($key) && preg_match(self::SECRET_KEYS, $key)) {
                $clean[$key] = '[hidden]';
                continue;
            }
            $clean[$key] = match (true) {
                is_array($value) => $depth < 3 ? self::sanitize($value, $depth + 1) : '[…]',
                is_string($value) => Str::limit($value, 500),
                is_scalar($value) || $value === null => $value,
                default => get_debug_type($value),
            };
        }

        return $clean;
    }
}
