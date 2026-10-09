<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\BusinessDocument;
use App\Models\Municipality;
use App\Models\RequiredDocument;
use App\Models\RiderDetail;
use App\Models\User;
use App\Models\UserKyc;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class VerificationDocumentPrivacyTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $otherOwner;
    private Business $business;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        Storage::fake('public');

        $this->owner = $this->createUser(User::ROLE_BUSINESS_OWNER, 'owner@example.com');
        $this->otherOwner = $this->createUser(User::ROLE_BUSINESS_OWNER, 'other@example.com');
        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
        ]);

        $this->business = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Test Restaurant',
            'business_description' => 'A test restaurant',
            'status' => 'under_review',
        ]);
    }

    public function test_business_owner_can_view_their_private_business_document(): void
    {
        $document = $this->createBusinessDocument();
        Storage::disk('local')->put($document->file_path, 'private permit');

        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson("/api/business-documents/{$document->id}/file")
            ->assertOk();

        $this->assertStringContainsString('private', $response->headers->get('cache-control'));
        $this->assertStringContainsString('no-store', $response->headers->get('cache-control'));
        $this->assertSame('private permit', $response->streamedContent());
    }

    public function test_business_documents_are_hidden_from_other_owners_and_tourists(): void
    {
        $document = $this->createBusinessDocument();
        Storage::disk('local')->put($document->file_path, 'private permit');

        $this->getJson("/api/business-documents/{$document->id}/file")
            ->assertUnauthorized();

        $this->actingAs($this->otherOwner, 'sanctum')
            ->getJson("/api/business-documents/{$document->id}/file")
            ->assertNotFound();

        $tourist = $this->createUser(User::ROLE_TOURIST, 'tourist@example.com');
        $this->actingAs($tourist, 'sanctum')
            ->getJson("/api/business-documents/{$document->id}/file")
            ->assertNotFound();
    }

    public function test_tourism_staff_can_view_business_documents(): void
    {
        $document = $this->createBusinessDocument();
        Storage::disk('local')->put($document->file_path, 'private permit');
        $staff = $this->createUser(User::ROLE_TOURISM_OFFICE, 'staff@example.com');

        $response = $this->actingAs($staff, 'sanctum')
            ->getJson("/api/business-documents/{$document->id}/file")
            ->assertOk();

        $this->assertSame('private permit', $response->streamedContent());
    }

    public function test_missing_private_business_document_returns_not_found(): void
    {
        $document = $this->createBusinessDocument();

        $this->actingAs($this->owner, 'sanctum')
            ->getJson("/api/business-documents/{$document->id}/file")
            ->assertNotFound();
    }

    public function test_business_document_upload_uses_private_storage(): void
    {
        $requiredDocument = RequiredDocument::create([
            'business_category_id' => $this->business->business_category_id,
            'document_name' => 'Business Permit',
            'document_code' => 'business_permit',
            'required_fields' => [],
        ]);

        $response = $this->actingAs($this->owner, 'sanctum')
            ->postJson("/api/business-owner/businesses/{$this->business->id}/documents", [
                'required_document_id' => $requiredDocument->id,
                'file' => UploadedFile::fake()->create('permit.pdf', 100, 'application/pdf'),
            ])
            ->assertCreated();

        $document = BusinessDocument::findOrFail($response->json('data.id'));
        Storage::disk('local')->assertExists($document->file_path);
        Storage::disk('public')->assertMissing($document->file_path);
        $this->assertSame(
            route('api.business-documents.file', $document->id),
            $response->json('data.file_url'),
        );
        $this->assertArrayNotHasKey('file_path', $response->json('data'));
    }

    public function test_kyc_documents_are_only_available_to_the_owner_or_tourism_staff(): void
    {
        $kyc = UserKyc::create([
            'user_id' => $this->owner->id,
            'valid_id_front' => 'ids/front.jpg',
        ]);
        Storage::disk('local')->put('ids/front.jpg', 'private identity document');

        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson("/api/users/{$kyc->id}/verification-documents/valid-id-front")
            ->assertOk();
        $this->assertSame('private identity document', $response->streamedContent());

        $staff = $this->createUser(User::ROLE_BANSUD_TOURISM_OFFICE, 'tourism-staff@example.com');
        $this->actingAs($staff, 'sanctum')
            ->getJson("/api/users/{$kyc->id}/verification-documents/valid-id-front")
            ->assertOk();

        $this->actingAs($this->otherOwner, 'sanctum')
            ->getJson("/api/users/{$kyc->id}/verification-documents/valid-id-front")
            ->assertNotFound();
    }

    public function test_kyc_route_rejects_unknown_document_names_and_missing_files(): void
    {
        $kyc = UserKyc::create([
            'user_id' => $this->owner->id,
            'valid_id_back' => 'ids/back.jpg',
        ]);

        $this->actingAs($this->owner, 'sanctum')
            ->getJson("/api/users/{$kyc->id}/verification-documents/unknown")
            ->assertNotFound();

        $this->getJson("/api/users/{$kyc->id}/verification-documents/valid-id-back")
            ->assertNotFound();
    }

    public function test_rider_documents_are_available_only_to_the_rider_and_tourism_staff(): void
    {
        $rider = $this->createUser(User::ROLE_RIDER, 'rider@example.com');
        $riderDetail = RiderDetail::create([
            'user_id' => $rider->id,
            'drivers_license_front' => 'riders/license-front.jpg',
        ]);
        Storage::disk('local')->put('riders/license-front.jpg', 'private rider document');

        $response = $this->actingAs($rider, 'sanctum')
            ->getJson("/api/rider-details/{$riderDetail->id}/verification-documents/drivers-license-front")
            ->assertOk();
        $this->assertSame('private rider document', $response->streamedContent());

        $staff = $this->createUser(User::ROLE_TOURISM_OFFICE, 'rider-doc-staff@example.com');
        $this->actingAs($staff, 'sanctum')
            ->getJson("/api/rider-details/{$riderDetail->id}/verification-documents/drivers-license-front")
            ->assertOk();

        $this->actingAs($this->owner, 'sanctum')
            ->getJson("/api/rider-details/{$riderDetail->id}/verification-documents/drivers-license-front")
            ->assertNotFound();
    }

    public function test_existing_public_verification_files_are_dry_run_then_moved_to_private_storage(): void
    {
        $businessDocument = $this->createBusinessDocument();
        $kyc = UserKyc::create([
            'user_id' => $this->owner->id,
            'valid_id_front' => 'ids/legacy-front.jpg',
        ]);
        $rider = $this->createUser(User::ROLE_RIDER, 'legacy-rider@example.com');
        RiderDetail::create([
            'user_id' => $rider->id,
            'drivers_license_front' => 'riders/legacy-license.jpg',
        ]);

        $paths = [
            $businessDocument->file_path,
            $kyc->valid_id_front,
            'riders/legacy-license.jpg',
        ];
        foreach ($paths as $path) {
            Storage::disk('public')->put($path, "legacy contents for {$path}");
        }

        Artisan::call('verification-documents:privatize');
        foreach ($paths as $path) {
            Storage::disk('public')->assertExists($path);
            Storage::disk('local')->assertMissing($path);
        }

        Artisan::call('verification-documents:privatize', ['--apply' => true]);
        foreach ($paths as $path) {
            Storage::disk('public')->assertMissing($path);
            Storage::disk('local')->assertExists($path);
            $this->assertSame("legacy contents for {$path}", Storage::disk('local')->get($path));
        }
    }

    private function createBusinessDocument(): BusinessDocument
    {
        return BusinessDocument::create([
            'business_id' => $this->business->id,
            'file_path' => 'businesses/documents/permit.pdf',
            'verification_status' => 'pending',
        ]);
    }

    private function createUser(string $role, string $email): User
    {
        return User::create([
            'email' => $email,
            'password' => Hash::make('Password123!'),
            'role' => $role,
            'account_status' => 'approved',
        ]);
    }
}
