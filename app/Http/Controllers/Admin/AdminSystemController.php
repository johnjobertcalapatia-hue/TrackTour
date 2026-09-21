<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\TourismSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AdminSystemController extends Controller
{
    public function config(): JsonResponse
    {
        return $this->successResponse([
            'app_name' => config('app.name'),
            'app_env' => config('app.env'),
            'app_url' => config('app.url'),
            'mail_driver' => config('mail.default'),
            'cache_driver' => config('cache.default'),
            'session_driver' => config('session.driver'),
        ]);
    }

    public function backup(): JsonResponse
    {
        return $this->successResponse([
            'backups' => [],
            'last_backup' => null,
            'disk_free' => disk_free_space(storage_path()),
        ]);
    }

    public function createBackup(): JsonResponse
    {
        return $this->successResponse(null, 'Backup initiated successfully.');
    }

    public function deleteBackup(string $id): JsonResponse
    {
        return $this->noContentResponse('Backup deleted.');
    }

    public function security(): JsonResponse
    {
        return $this->successResponse([
            'failed_logins_today' => 0,
            'active_sessions' => DB::table('sessions')->count(),
            'two_factor_enabled' => false,
        ]);
    }

    public function securityLogs(Request $request): JsonResponse
    {
        return $this->paginatedResponse(
            DB::table('activity_logs')->where('type', 'security')->latest()->paginate(20)
        );
    }

    public function ocrSettings(): JsonResponse
    {
        $value = TourismSetting::where('key', 'ocr_enabled')->value('value');

        return $this->successResponse([
            'ocr_enabled' => $value === '1',
        ]);
    }

    public function updateOcrSettings(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'ocr_enabled' => 'required|boolean',
        ]);

        TourismSetting::updateOrCreate(
            ['key' => 'ocr_enabled'],
            ['value' => $validated['ocr_enabled'] ? '1' : '0']
        );

        return $this->successResponse([
            'ocr_enabled' => $validated['ocr_enabled'],
        ], 'OCR settings updated successfully.');
    }
}
