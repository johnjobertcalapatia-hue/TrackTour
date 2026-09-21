<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TourismSetting;
use App\Services\OcrService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DocumentOcrController extends Controller
{
    private OcrService $ocr;

    public function __construct(OcrService $ocr)
    {
        $this->ocr = $ocr;
    }

    public function extract(Request $request): JsonResponse
    {
        $request->validate([
            'file' => 'required|file|mimes:jpg,jpeg,png,gif,webp,pdf|max:10240',
            'document_type' => 'nullable|string|max:50',
        ]);

        $ocrEnabled = TourismSetting::where('key', 'ocr_enabled')->value('value');
        if ($ocrEnabled !== '1') {
            return $this->errorResponse(
                'OCR is currently disabled. Please enable it in the admin settings to use document extraction.',
                503
            );
        }

        if (!$this->ocr->isAvailable()) {
            return $this->errorResponse(
                'Tesseract OCR is not installed on the server. Please install Tesseract to use document extraction.',
                null,
                503
            );
        }

        $file = $request->file('file');

        $tempPath = $file->getPathname();

        if ($file->getClientOriginalExtension() === 'pdf') {
            return $this->errorResponse(
                'PDF OCR is not yet supported. Please upload an image file (JPG, PNG).',
                null,
                400
            );
        }

        if (!in_array($file->getMimeType(), ['image/jpeg', 'image/png', 'image/gif', 'image/webp'])) {
            return $this->errorResponse(
                'Unsupported image format. Please upload JPG, PNG, GIF, or WebP.',
                null,
                400
            );
        }

        try {
            $result = $this->ocr->processImage(
                $tempPath,
                $request->input('document_type')
            );

            return $this->successResponse([
                'detected_type' => $result['detected_type'],
                'detected_label' => $result['detected_label'],
                'fields' => $result['fields'],
                'raw_text' => $result['raw_text'],
            ], 'Document processed successfully.');
        } catch (\Exception $e) {
            return $this->errorResponse(
                'Failed to process document: ' . $e->getMessage(),
                500
            );
        }
    }

    public function status(): JsonResponse
    {
        $available = $this->ocr->isAvailable();
        $ocrEnabled = TourismSetting::where('key', 'ocr_enabled')->value('value');

        return $this->successResponse([
            'tesseract_installed' => $available,
            'binary_path' => $available ? $this->ocr->getBinaryPath() : null,
            'ocr_enabled' => $ocrEnabled === '1',
        ], 'OCR service status.');
    }
}
