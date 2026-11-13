<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\TourismSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Bansud Tourism Office identity.
 *
 * The office logo, cover photo and contact details are municipal-wide
 * branding — not per-user data — so they live in the canonical
 * tourism_settings key/value store (municipality_id = null), shared with the
 * landing content and the fare policies. Images follow the existing business
 * logo convention: the stored value is the public-disk URL (`/storage/...`),
 * which `toAssetUrl()` resolves on the frontend.
 *
 * Reached from the Admin sidebar's "Signed in as" card (/admin/profile).
 */
class AdminOfficeProfileController extends Controller
{
    private const IMAGE_KEYS = [
        'logo' => 'office_logo',
        'cover' => 'office_cover',
    ];

    /** Payload field => tourism_settings key (text fields). */
    private const TEXT_KEYS = [
        'name' => 'office_name',
        'about' => 'office_about',
        'email' => 'office_email',
        'phone' => 'office_phone',
        'address' => 'office_address',
    ];

    private const DEFAULTS = [
        'office_name' => 'Bansud Tourism Office',
        'office_about' => '',
        'office_email' => '',
        'office_phone' => '',
        'office_address' => 'Municipal Hall, Bansud, Oriental Mindoro',
    ];

    public function show(): JsonResponse
    {
        return $this->successResponse(
            $this->payload(),
            'Bansud Tourism Office profile retrieved successfully.'
        );
    }

    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:150'],
            'about' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'email' => ['sometimes', 'nullable', 'email', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'logo' => ['sometimes', 'nullable', 'file', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
            'cover' => ['sometimes', 'nullable', 'file', 'mimes:jpg,jpeg,png,webp', 'max:10240'],
            'remove_logo' => ['sometimes', 'boolean'],
            'remove_cover' => ['sometimes', 'boolean'],
        ], [
            'name.required' => 'Give the office a name.',
            'logo.mimes' => 'The logo must be a JPG, PNG or WebP image.',
            'logo.max' => 'The logo may not be larger than 5 MB.',
            'cover.mimes' => 'The cover photo must be a JPG, PNG or WebP image.',
            'cover.max' => 'The cover photo may not be larger than 10 MB.',
        ]);

        $changes = [];

        DB::transaction(function () use ($request, $validated, &$changes) {
            foreach (self::TEXT_KEYS as $field => $key) {
                if (! array_key_exists($field, $validated)) {
                    continue;
                }

                $value = is_string($validated[$field]) ? trim($validated[$field]) : $validated[$field];
                $this->put($key, $value === '' ? null : $value);
                $changes[] = $field;
            }

            foreach (self::IMAGE_KEYS as $field => $key) {
                // An upload always wins over a removal flag in the same request.
                if ($request->hasFile($field)) {
                    $this->replaceImage($key, $validated[$field], $field === 'logo' ? 'office/logo' : 'office/cover');
                    $changes[] = $field;
                    continue;
                }

                if ($request->boolean('remove_'.$field)) {
                    $this->replaceImage($key, null);
                    $changes[] = $field;
                }
            }
        });

        $summary = $changes === [] ? 'no changes' : implode(', ', $changes);

        ActivityLog::record(
            'office.profile_updated',
            'Bansud Tourism Office profile updated ('.$summary.').',
            null,
            ActivityLog::TYPE_SETTINGS
        );

        return $this->successResponse(
            $this->payload(),
            'Bansud Tourism Office profile updated successfully.'
        );
    }

    /** Current office identity, with defaults for anything never set. */
    private function payload(): array
    {
        $keys = array_merge(array_values(self::TEXT_KEYS), array_values(self::IMAGE_KEYS));

        $stored = TourismSetting::query()
            ->whereNull('municipality_id')
            ->whereIn('key', $keys)
            ->get(['key', 'value', 'updated_at']);

        $values = $stored->pluck('value', 'key');

        $payload = [];
        foreach (self::TEXT_KEYS as $field => $key) {
            $payload[$field] = (string) ($values[$key] ?? self::DEFAULTS[$key]);
        }

        $payload['logo_url'] = $values->get('office_logo') ?: null;
        $payload['cover_url'] = $values->get('office_cover') ?: null;
        $payload['updated_at'] = $stored->max('updated_at');

        // `about` / `email` / `phone` are legitimately empty strings.
        return $payload;
    }

    /**
     * Store one setting. `municipality_id` is explicit: the unique index is
     * (municipality_id, key), so the null row is the municipal-wide value.
     */
    private function put(string $key, ?string $value): void
    {
        TourismSetting::updateOrCreate(
            ['municipality_id' => null, 'key' => $key],
            ['value' => $value]
        );
    }

    /**
     * Replace (or clear, when $file is null) an image setting and remove the
     * file it replaced so the public disk does not accumulate orphans.
     */
    private function replaceImage(string $key, $file = null, string $directory = 'office'): void
    {
        $current = TourismSetting::query()
            ->whereNull('municipality_id')
            ->where('key', $key)
            ->value('value');

        if (is_string($current) && $current !== '' && ! str_starts_with($current, 'http')) {
            Storage::disk('public')->delete(str_replace('/storage/', '', $current));
        }

        if ($file === null) {
            $this->put($key, null);

            return;
        }

        $path = $file->store($directory, 'public');
        $this->put($key, Storage::url($path));
    }
}
