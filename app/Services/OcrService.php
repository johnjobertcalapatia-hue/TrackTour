<?php

namespace App\Services;

use thiagoalessio\TesseractOCR\TesseractOCR;

class OcrService
{
    private DocumentExtractor $extractor;

    public function __construct(DocumentExtractor $extractor)
    {
        $this->extractor = $extractor;
    }

    public function isAvailable(): bool
    {
        $tesseract = $this->findBinary();
        if (!$tesseract) return false;

        $output = null;
        $returnCode = null;
        exec("\"$tesseract\" --version 2>&1", $output, $returnCode);

        return $returnCode === 0;
    }

    public function getBinaryPath(): ?string
    {
        return $this->findBinary();
    }

    public function processImage(string $imagePath, ?string $documentType = null): array
    {
        $preprocessedPath = $this->preprocessImage($imagePath);
        $text = $this->runOcr($preprocessedPath);

        if ($preprocessedPath !== $imagePath) {
            @unlink($preprocessedPath);
        }

        return $this->extractor->extract($text, $documentType);
    }

    public function processImageRaw(string $imagePath): string
    {
        $preprocessedPath = $this->preprocessImage($imagePath);
        $text = $this->runOcr($preprocessedPath);

        if ($preprocessedPath !== $imagePath) {
            @unlink($preprocessedPath);
        }

        return $text;
    }

    private function runOcr(string $path): string
    {
        try {
            $tesseract = new TesseractOCR($path);

            if ($binary = $this->findBinary()) {
                $tesseract->executable($binary);
            }

            $tesseract->lang('eng+fil');

            return trim($tesseract->run());
        } catch (\Exception $e) {
            throw new \RuntimeException('OCR processing failed: ' . $e->getMessage());
        }
    }

    private function preprocessImage(string $path): string
    {
        if (!extension_loaded('gd')) {
            return $path;
        }

        $info = @getimagesize($path);
        if (!$info) return $path;

        $mime = $info['mime'];

        switch ($mime) {
            case 'image/jpeg':
                $src = @imagecreatefromjpeg($path);
                break;
            case 'image/png':
                $src = @imagecreatefrompng($path);
                break;
            case 'image/gif':
                $src = @imagecreatefromgif($path);
                break;
            case 'image/webp':
                if (function_exists('imagecreatefromwebp')) {
                    $src = @imagecreatefromwebp($path);
                } else {
                    return $path;
                }
                break;
            default:
                return $path;
        }

        if (!$src) return $path;

        $width = imagesx($src);
        $height = imagesy($src);

        $newWidth = min($width, 2500);
        $newHeight = (int)($height * ($newWidth / $width));
        $resized = imagecreatetruecolor($newWidth, $newHeight);
        imagecopyresampled($resized, $src, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height);
        imagedestroy($src);

        imagefilter($resized, IMG_FILTER_GRAYSCALE);
        imagefilter($resized, IMG_FILTER_CONTRAST, -30);
        imagefilter($resized, IMG_FILTER_BRIGHTNESS, 15);

        $tempPath = tempnam(sys_get_temp_dir(), 'ocr_') . '.png';
        imagepng($resized, $tempPath, 9);
        imagedestroy($resized);

        return $tempPath;
    }

    private function findBinary(): ?string
    {
        $candidates = [
            'C:\Program Files\Tesseract-OCR\tesseract.exe',
            'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
            '/usr/bin/tesseract',
            '/usr/local/bin/tesseract',
            '/opt/homebrew/bin/tesseract',
        ];

        $which = trim(shell_exec('which tesseract 2>/dev/null') ?? '');
        if ($which && is_executable($which)) {
            return $which;
        }

        $where = trim(shell_exec('where tesseract 2>/dev/null') ?? '');
        if ($where && file_exists($where)) {
            return $where;
        }

        foreach ($candidates as $path) {
            if (file_exists($path)) {
                return $path;
            }
        }

        return null;
    }
}
