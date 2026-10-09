<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\BusinessDocument;
use App\Models\RiderDetail;
use App\Models\User;
use App\Models\UserKyc;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class VerificationDocumentController extends Controller
{
    public function business(Request $request, BusinessDocument $businessDocument): JsonResponse|StreamedResponse
    {
        $user = $request->user();
        $isOwner = $businessDocument->business?->owner_id === $user->id;

        if (! $isOwner && ! $this->isTourismStaff($user)) {
            return $this->notFoundResponse('Document not found.');
        }

        return $this->privateFileResponse($businessDocument->file_path);
    }

    public function kyc(Request $request, UserKyc $kyc, string $document): JsonResponse|StreamedResponse
    {
        $field = match ($document) {
            'valid-id-front' => 'valid_id_front',
            'valid-id-back' => 'valid_id_back',
            'selfie-holding-id' => 'selfie_holding_id',
            default => null,
        };

        if ($field === null) {
            return $this->notFoundResponse('Document not found.');
        }

        $user = $request->user();
        if ($kyc->user_id !== $user->id && ! $this->isTourismStaff($user)) {
            return $this->notFoundResponse('Document not found.');
        }

        return $this->privateFileResponse($kyc->getAttribute($field));
    }

    public function rider(Request $request, RiderDetail $riderDetail, string $document): JsonResponse|StreamedResponse
    {
        $field = match ($document) {
            'drivers-license-front' => 'drivers_license_front',
            'drivers-license-back' => 'drivers_license_back',
            'vehicle-registration' => 'or_cr_image',
            'nbi-clearance' => 'nbi_clearance',
            default => null,
        };

        if ($field === null) {
            return $this->notFoundResponse('Document not found.');
        }

        $user = $request->user();
        if ($riderDetail->user_id !== $user->id && ! $this->isTourismStaff($user)) {
            return $this->notFoundResponse('Document not found.');
        }

        return $this->privateFileResponse($riderDetail->getAttribute($field));
    }

    private function privateFileResponse(?string $path): JsonResponse|StreamedResponse
    {
        $disk = Storage::disk('local');
        if (! $path || ! $disk->exists($path)) {
            return $this->notFoundResponse('Document not found.');
        }

        return $disk->response($path, basename($path), [
            'Cache-Control' => 'private, no-store, max-age=0',
            'X-Content-Type-Options' => 'nosniff',
        ], 'inline');
    }

    private function isTourismStaff(User $user): bool
    {
        return in_array($user->role, [
            User::ROLE_TOURISM_OFFICE,
            User::ROLE_BANSUD_TOURISM_OFFICE,
        ], true);
    }
}
