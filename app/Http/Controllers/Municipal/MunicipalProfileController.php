<?php

namespace App\Http\Controllers\Municipal;

use App\Models\ActivityLog;
use App\Models\Municipality;
use App\Models\TourismSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Municipal Tourism Office profile & settings.
 *
 * Contact details live in the canonical tourism_settings key/value store with
 * this municipality's id (the Bansud office profile uses the null row). The
 * logo and cover photo are the municipality's own `logo` / `cover_photo`, which
 * the public landing and tourist pages already show. Name, district and
 * province stay with the Bansud Tourism Office.
 */
class MunicipalProfileController extends MunicipalController
{
    private const TEXT_KEYS = [
        'office_name' => 'office_name',
        'about' => 'office_about',
        'email' => 'office_email',
        'phone' => 'office_phone',
        'address' => 'office_address',
        'office_hours' => 'office_hours',
    ];

    public function show(Request $request): JsonResponse
    {
        return $this->successResponse($this->payload($request));
    }

    public function update(Request $request): JsonResponse
    {
        $municipality = $this->municipality($request);

        $validated = $request->validate([
            'office_name' => ['sometimes', 'required', 'string', 'max:150'],
            'about' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'email' => ['sometimes', 'nullable', 'email', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'office_hours' => ['sometimes', 'nullable', 'string', 'max:120'],
            'logo' => ['sometimes', 'nullable', 'file', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
            'cover' => ['sometimes', 'nullable', 'file', 'mimes:jpg,jpeg,png,webp', 'max:10240'],
            'remove_logo' => ['sometimes', 'boolean'],
            'remove_cover' => ['sometimes', 'boolean'],
        ], [
            'office_name.required' => 'Give the office a name.',
            'logo.mimes' => 'The logo must be a JPG, PNG or WebP image.',
            'logo.max' => 'The logo may not be larger than 5 MB.',
            'cover.mimes' => 'The cover photo must be a JPG, PNG or WebP image.',
            'cover.max' => 'The cover photo may not be larger than 10 MB.',
        ]);

        $changes = [];

        DB::transaction(function () use ($request, $validated, $municipality, &$changes) {
            foreach (self::TEXT_KEYS as $field => $key) {
                if (! array_key_exists($field, $validated)) {
                    continue;
                }
                $value = is_string($validated[$field]) ? trim($validated[$field]) : $validated[$field];
                TourismSetting::updateOrCreate(
                    ['municipality_id' => $municipality->id, 'key' => $key],
                    ['value' => $value === '' ? null : $value]
                );
                $changes[] = $field;
            }

            foreach (['logo' => 'logo', 'cover' => 'cover_photo'] as $field => $column) {
                if ($request->hasFile($field)) {
                    $this->replaceImage($municipality, $column, $validated[$field]->store("municipalities/{$municipality->id}", 'public'));
                    $changes[] = $field;
                } elseif ($request->boolean('remove_'.$field)) {
                    $this->replaceImage($municipality, $column, null);
                    $changes[] = $field;
                }
            }
        });

        ActivityLog::record(
            'municipal.profile_updated',
            $this->scope->auditPrefix($request->user()).'Office profile updated ('.($changes ? implode(', ', $changes) : 'no changes').').',
            $municipality,
            ActivityLog::TYPE_SETTINGS
        );

        return $this->successResponse($this->payload($request), 'Office profile updated successfully.');
    }

    private function payload(Request $request): array
    {
        $municipality = $this->municipality($request)->fresh();
        $values = TourismSetting::query()
            ->where('municipality_id', $municipality->id)
            ->whereIn('key', array_values(self::TEXT_KEYS))
            ->pluck('value', 'key');

        $defaults = [
            'office_name' => "{$municipality->name} Tourism Office",
            'office_address' => "Municipal Hall, {$municipality->name}, {$municipality->province}",
        ];

        $payload = [
            'municipality' => [
                'id' => $municipality->id,
                'name' => $municipality->name,
                'district' => $municipality->district,
                'province' => $municipality->province,
            ],
            'logo_url' => $municipality->logo,
            'cover_url' => $municipality->cover_photo,
            'account' => [
                'name' => $request->user()->full_name,
                'email' => $request->user()->email,
            ],
        ];

        foreach (self::TEXT_KEYS as $field => $key) {
            $payload[$field] = (string) ($values[$key] ?? $defaults[$key] ?? '');
        }

        return $payload;
    }

    private function replaceImage(Municipality $municipality, string $column, ?string $newPath): void
    {
        $current = $municipality->getAttribute($column);
        if (is_string($current) && $current !== '' && str_starts_with($current, '/storage/municipalities/')) {
            Storage::disk('public')->delete(str_replace('/storage/', '', $current));
        }

        $municipality->forceFill([$column => $newPath ? Storage::url($newPath) : null])->save();
    }
}
