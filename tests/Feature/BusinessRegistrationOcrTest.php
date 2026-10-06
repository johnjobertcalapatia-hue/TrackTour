<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\RequiredDocument;
use App\Models\TourismSetting;
use App\Models\User;
use App\Services\DocumentExtractor;
use App\Services\OcrService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class BusinessRegistrationOcrTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();

        $category = BusinessCategory::where('name', 'Restaurant')->first();
        if ($category && RequiredDocument::where('business_category_id', $category->id)->doesntExist()) {
            RequiredDocument::create([
                'business_category_id' => $category->id,
                'document_name' => "Mayor's Business Permit",
                'document_code' => 'mayors_permit',
                'is_required' => true,
                'has_expiration' => true,
                'validity_period' => '1 Year',
                'description' => 'Official business permit issued by the municipal government.',
                'required_fields' => ['document_number', 'issue_date', 'expiration_date'],
                'is_active' => true,
                'sort_order' => 0,
                'grace_period_days' => 30,
                'effective_date' => now(),
            ]);
        }
    }

    private function createOwner(): User
    {
        $user = User::factory()->create([
            'role' => User::ROLE_BUSINESS_OWNER,
            'account_status' => 'approved',
        ]);
        $user->profile()->create([
            'first_name' => 'Test',
            'last_name' => 'Owner',
        ]);

        return $user;
    }

    private function createTestImage(string $text): UploadedFile
    {
        $gd = imagecreatetruecolor(600, 300);
        $white = imagecolorallocate($gd, 255, 255, 255);
        $black = imagecolorallocate($gd, 0, 0, 0);
        imagefill($gd, 0, 0, $white);
        $lines = explode("\n", $text);
        $y = 20;
        foreach ($lines as $line) {
            imagestring($gd, 4, 20, $y, $line, $black);
            $y += 22;
        }
        $path = tempnam(sys_get_temp_dir(), 'test_doc_') . '.png';
        imagepng($gd, $path);
        imagedestroy($gd);

        return new UploadedFile($path, 'test_document.png', 'image/png', null, true);
    }

    public function test_ocr_endpoint_extracts_document_data(): void
    {
        if (! extension_loaded('gd')) {
            $this->markTestSkipped('GD extension is required to create fake images.');
        }

        $user = $this->createOwner();
        $file = $this->createTestImage("PERMIT NO: PMT-2026-00123\nBusiness Name: TEST RESTAURANT\nDate Issued: January 15, 2026\nExpiry Date: December 31, 2027");

        $response = $this->actingAs($user)
            ->postJson('/api/documents/extract', [
                'file' => $file,
                'document_type' => 'business_permit',
            ]);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'success',
            'data' => ['detected_type', 'detected_label', 'fields', 'raw_text'],
        ]);

        $data = $response->json('data');
        $this->assertEquals('business_permit', $data['detected_type']);
        $this->assertStringContainsString('PMT-2026-00123', $data['fields']['permit_number']);
        $this->assertStringContainsString('2027', $data['fields']['expiry_date']);
    }

    public function test_business_created_with_documents_and_ocr_data(): void
    {
        if (! extension_loaded('gd')) {
            $this->markTestSkipped('GD extension is required to create fake images.');
        }

        $user = $this->createOwner();
        $category = BusinessCategory::where('name', 'Restaurant')->first();
        $municipality = Municipality::first();
        $barangay = Barangay::first();
        $requiredDoc = RequiredDocument::first();

        $this->assertNotNull($category, 'Restaurant category must exist');
        $this->assertNotNull($requiredDoc, 'At least one required document must exist');

        $file = $this->createTestImage("PERMIT NO: PMT-2026-00123\nBusiness Name: TEST RESTAURANT\nDate Issued: January 15, 2026\nExpiry Date: December 31, 2027");

        $payload = [
            'business_name' => 'OCR Test Restaurant',
            'business_description' => 'Testing OCR document upload',
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'barangay_id' => $barangay->id,
            'address' => '123 Test Street',
            'contact_number' => '09171234567',
            'email' => 'ocr-test@example.com',
            'latitude' => 14.123,
            'longitude' => 121.123,
            'opening_time' => '08:00',
            'closing_time' => '17:00',
            'business_days' => ['Monday', 'Tuesday', 'Wednesday'],
            'legal_entity_type' => 'Sole Proprietorship',
            'tin' => '123-456-789-000',
            'year_established' => '2020',
            'owner_full_name' => 'Test Owner',
            'owner_address' => '456 Owner Street',
            'initial_capital' => 100000,
            'gross_floor_area' => 50,
            'number_of_employees' => 5,
            'occupancy_status' => 'Owned',
            'documents' => [
                [
                    'file' => $file,
                    'required_document_id' => $requiredDoc->id,
                    'document_number' => 'PMT-2026-00123',
                    'registered_name' => 'TEST RESTAURANT',
                    'issue_date' => '2026-01-15',
                    'expiration_date' => '2027-12-31',
                    'ocr_document_number' => 'PMT-2026-00123',
                    'ocr_registered_name' => 'TEST RESTAURANT',
                    'ocr_issue_date' => 'January 15, 2026',
                    'ocr_expiration_date' => 'December 31, 2027',
                ],
            ],
        ];

        $response = $this->actingAs($user)
            ->post('/api/business-owner/businesses', $payload, [
                'Accept' => 'application/json',
            ]);

        $response->assertStatus(201);

        $business = Business::where('business_name', 'OCR Test Restaurant')->first();
        $this->assertNotNull($business);
        $this->assertEquals('under_review', $business->status);

        $documents = $business->documents;
        $this->assertCount(1, $documents);

        $doc = $documents->first();
        $this->assertEquals('PMT-2026-00123', $doc->document_number);
        $this->assertEquals('2026-01-15', $doc->issue_date->format('Y-m-d'));
        $this->assertEquals('2027-12-31', $doc->expiration_date->format('Y-m-d'));
        $this->assertEquals('pending', $doc->verification_status);
        $this->assertFalse($doc->flagged);
        $this->assertNull($doc->flag_reason);
        $this->assertNull($doc->ocr_data);
    }

    public function test_business_with_mismatched_ocr_data_gets_flagged(): void
    {
        if (! extension_loaded('gd')) {
            $this->markTestSkipped('GD extension is required to create fake images.');
        }

        $user = $this->createOwner();
        $category = BusinessCategory::where('name', 'Restaurant')->first();
        $municipality = Municipality::first();
        $barangay = Barangay::first();
        $requiredDoc = RequiredDocument::first();

        $file = $this->createTestImage("PERMIT NO: PMT-2026-00123\nBusiness Name: TEST RESTAURANT\nDate Issued: January 15, 2026\nExpiry Date: December 31, 2027");

        $payload = [
            'business_name' => 'OCR Flagged Test',
            'business_description' => 'Testing OCR mismatch flagging',
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'barangay_id' => $barangay->id,
            'address' => '123 Test Street',
            'contact_number' => '09171234567',
            'email' => 'ocr-flagged@example.com',
            'latitude' => 14.123,
            'longitude' => 121.123,
            'opening_time' => '08:00',
            'closing_time' => '17:00',
            'business_days' => ['Monday', 'Tuesday', 'Wednesday'],
            'legal_entity_type' => 'Sole Proprietorship',
            'tin' => '123-456-789-000',
            'year_established' => '2020',
            'owner_full_name' => 'Test Owner',
            'owner_address' => '456 Owner Street',
            'initial_capital' => 100000,
            'gross_floor_area' => 50,
            'number_of_employees' => 5,
            'occupancy_status' => 'Owned',
            'documents' => [
                [
                    'file' => $file,
                    'required_document_id' => $requiredDoc->id,
                    'document_number' => 'PMT-2026-99999',
                    'issue_date' => '2026-06-15',
                    'expiration_date' => '2028-12-31',
                    'ocr_document_number' => 'PMT-2026-00123',
                    'ocr_issue_date' => 'January 15, 2026',
                    'ocr_expiration_date' => 'December 31, 2027',
                ],
            ],
        ];

        $response = $this->actingAs($user)
            ->post('/api/business-owner/businesses', $payload, [
                'Accept' => 'application/json',
            ]);

        $response->assertStatus(201);

        $business = Business::where('business_name', 'OCR Flagged Test')->first();
        $this->assertNotNull($business);

        $documents = $business->documents;
        $this->assertCount(1, $documents);

        $doc = $documents->first();
        $this->assertEquals('flagged', $doc->verification_status);
        $this->assertTrue($doc->flagged);
        $this->assertNotNull($doc->flag_reason);
        $this->assertStringContainsString('Document number mismatch', $doc->flag_reason);
        $this->assertStringContainsString('PMT-2026-00123', $doc->flag_reason);
        $this->assertStringContainsString('PMT-2026-99999', $doc->flag_reason);

        $this->assertNotNull($doc->ocr_data);
        $this->assertEquals('PMT-2026-00123', $doc->ocr_data['document_number']);
    }

    public function test_ocr_endpoint_rejects_without_auth(): void
    {
        if (! extension_loaded('gd')) {
            $this->markTestSkipped('GD extension is required to create fake images.');
        }

        $file = $this->createTestImage("PERMIT NO: TEST-001");

        $response = $this->postJson('/api/documents/extract', [
            'file' => $file,
        ]);

        $response->assertStatus(401);
    }

    private function createRawDocument(string $mime, string $content): UploadedFile
    {
        $extensions = [
            'image/png' => 'png',
            'image/jpeg' => 'jpg',
            'application/pdf' => 'pdf',
        ];
        $path = tempnam(sys_get_temp_dir(), 'ocr_doc_');
        file_put_contents($path, $content);

        return new UploadedFile(
            $path,
            'raw_document.' . $extensions[$mime],
            $mime,
            null,
            true
        );
    }

    private function createPdfFile(): UploadedFile
    {
        $pdf = "%PDF-1.4\n"
            . "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
            . "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
            . "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
            . "xref\n0 4\n0000000000 65535 f \n"
            . "0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n"
            . "trailer<</Size 4/Root 1 0 R>>\n"
            . "startxref\n150\n%%EOF";

        return $this->createRawDocument('application/pdf', $pdf);
    }

    public function test_ocr_endpoint_returns_503_when_tesseract_unavailable(): void
    {
        TourismSetting::updateOrCreate(['key' => 'ocr_enabled'], ['value' => '1']);

        $ocr = $this->createMock(OcrService::class);
        $ocr->method('isAvailable')->willReturn(false);
        $this->app->instance(OcrService::class, $ocr);

        $user = $this->createOwner();
        $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=');
        $file = $this->createRawDocument('image/png', $png);

        $response = $this->actingAs($user)
            ->postJson('/api/documents/extract', ['file' => $file]);

        $response->assertStatus(503);
        $response->assertJson([
            'success' => false,
            'message' => 'Tesseract OCR is not installed on the server. Please install Tesseract to use document extraction.',
        ]);
    }

    public function test_ocr_endpoint_rejects_pdf_with_400_not_500(): void
    {
        TourismSetting::updateOrCreate(['key' => 'ocr_enabled'], ['value' => '1']);

        $ocr = $this->createMock(OcrService::class);
        $ocr->method('isAvailable')->willReturn(true);
        $this->app->instance(OcrService::class, $ocr);

        $user = $this->createOwner();
        $file = $this->createPdfFile();

        $response = $this->actingAs($user)
            ->postJson('/api/documents/extract', ['file' => $file]);

        $response->assertStatus(400);
        $response->assertJson([
            'success' => false,
            'message' => 'PDF OCR is not yet supported. Please upload an image file (JPG, PNG).',
        ]);
    }

    public function test_business_creation_rejects_without_required_fields(): void
    {
        $user = $this->createOwner();

        $response = $this->actingAs($user)
            ->postJson('/api/business-owner/businesses', [
                'business_name' => 'Incomplete',
            ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors([
            'business_description', 'business_category_id', 'municipality_id',
            'barangay_id', 'address', 'contact_number', 'email',
            'latitude', 'longitude', 'opening_time', 'closing_time',
            'business_days', 'legal_entity_type', 'tin', 'year_established',
        ]);
    }
}
