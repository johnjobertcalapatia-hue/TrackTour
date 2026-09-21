<?php

namespace Database\Seeders;

use App\Models\BusinessCategory;
use App\Models\RequiredDocument;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class RequiredDocumentSeeder extends Seeder
{
    public function run(): void
    {
        // Truncate existing required documents to re-seed per category
        DB::statement('SET FOREIGN_KEY_CHECKS=0;');
        RequiredDocument::truncate();
        DB::statement('SET FOREIGN_KEY_CHECKS=1;');

        $templates = [
            'dti_certificate' => [
                'document_code' => 'dti_certificate',
                'document_name' => 'DTI Registration Certificate',
                'description' => 'Proof that the business name is legally registered with the Department of Trade and Industry.',
                'has_expiration' => false,
                'validity_period' => null,
                'required_fields' => ['document_number', 'issue_date'],
                'grace_period_days' => 30,
            ],
            'sec_registration' => [
                'document_code' => 'sec_registration',
                'document_name' => 'SEC Registration Certificate',
                'description' => 'Required for corporations and partnerships.',
                'has_expiration' => false,
                'validity_period' => null,
                'required_fields' => ['document_number', 'issue_date'],
                'grace_period_days' => 30,
            ],
            'bir_certificate' => [
                'document_code' => 'bir_certificate',
                'document_name' => 'BIR Certificate of Registration (Form 2303)',
                'description' => 'Tax registration certificate issued by the Bureau of Internal Revenue.',
                'has_expiration' => false,
                'validity_period' => null,
                'required_fields' => ['document_number', 'issue_date'],
                'grace_period_days' => 30,
            ],
            'barangay_clearance' => [
                'document_code' => 'barangay_clearance',
                'document_name' => 'Barangay Business Clearance',
                'description' => 'Clearance issued by the local barangay where the business operates.',
                'has_expiration' => true,
                'validity_period' => '1 Year',
                'required_fields' => ['document_number', 'issue_date', 'expiration_date'],
                'grace_period_days' => 30,
            ],
            'mayors_permit' => [
                'document_code' => 'mayors_permit',
                'document_name' => "Mayor's Business Permit",
                'description' => 'Official business permit issued by the municipal government.',
                'has_expiration' => true,
                'validity_period' => '1 Year',
                'required_fields' => ['document_number', 'issue_date', 'expiration_date'],
                'grace_period_days' => 30,
            ],
            'fire_safety' => [
                'document_code' => 'fire_safety',
                'document_name' => 'Fire Safety Inspection Certificate (FSIC)',
                'description' => 'Certificate issued by the Bureau of Fire Protection.',
                'has_expiration' => true,
                'validity_period' => '1 Year',
                'required_fields' => ['document_number', 'issue_date', 'expiration_date'],
                'grace_period_days' => 30,
            ],
            'occupancy_permit' => [
                'document_code' => 'occupancy_permit',
                'document_name' => 'Certificate of Occupancy',
                'description' => 'Confirms building safety and readiness for commercial occupancy.',
                'has_expiration' => false,
                'validity_period' => null,
                'required_fields' => ['document_number', 'issue_date'],
                'grace_period_days' => 30,
            ],
            'sanitary_permit' => [
                'document_code' => 'sanitary_permit',
                'document_name' => 'Sanitary Permit',
                'description' => 'Health and sanitation permit issued by the local health office.',
                'has_expiration' => true,
                'validity_period' => '1 Year',
                'required_fields' => ['document_number', 'issue_date', 'expiration_date'],
                'grace_period_days' => 30,
            ],
            'health_certificates' => [
                'document_code' => 'health_certificates',
                'document_name' => 'Food Handler Health Certificate',
                'description' => 'Individual health certificates for food handling staff.',
                'has_expiration' => true,
                'validity_period' => '1 Year',
                'required_fields' => ['document_number', 'issue_date', 'expiration_date'],
                'grace_period_days' => 30,
            ],
            'food_safety' => [
                'document_code' => 'food_safety',
                'document_name' => 'Food Safety Compliance Certificate',
                'description' => 'Proof of adherence to national food safety standards.',
                'has_expiration' => true,
                'validity_period' => '1 Year',
                'required_fields' => ['document_number', 'issue_date', 'expiration_date'],
                'grace_period_days' => 30,
            ],
            'dot_accreditation' => [
                'document_code' => 'dot_accreditation',
                'document_name' => 'DOT Accreditation Certificate',
                'description' => 'Official accreditation from the Department of Tourism.',
                'has_expiration' => true,
                'validity_period' => '2 Years',
                'required_fields' => ['document_number', 'issue_date', 'expiration_date'],
                'grace_period_days' => 60,
            ],
            'environmental_compliance' => [
                'document_code' => 'environmental_compliance',
                'document_name' => 'Environmental Compliance Certificate (ECC)',
                'description' => 'Clearance from the Department of Environment and Natural Resources.',
                'has_expiration' => false,
                'validity_period' => null,
                'required_fields' => ['document_number', 'issue_date'],
                'grace_period_days' => 30,
            ],
            'ltfrb_certificate' => [
                'document_code' => 'ltfrb_certificate',
                'document_name' => 'LTFRB Franchise Certificate',
                'description' => 'Franchise permit from Land Transportation Franchising Board.',
                'has_expiration' => true,
                'validity_period' => '5 Years',
                'required_fields' => ['document_number', 'issue_date', 'expiration_date'],
                'grace_period_days' => 60,
            ],
            'vehicle_registration' => [
                'document_code' => 'vehicle_registration',
                'document_name' => 'Vehicle Registration (OR/CR)',
                'description' => 'Official Receipt and Certificate of Registration for vehicles.',
                'has_expiration' => true,
                'validity_period' => '1 Year',
                'required_fields' => ['document_number', 'issue_date', 'expiration_date'],
                'grace_period_days' => 30,
            ],
            'tourism_accreditation' => [
                'document_code' => 'tourism_accreditation',
                'document_name' => 'Tourism Accreditation / Tour Guide License',
                'description' => 'Professional tour guide or operator license.',
                'has_expiration' => true,
                'validity_period' => '1 Year',
                'required_fields' => ['document_number', 'issue_date', 'expiration_date'],
                'grace_period_days' => 30,
            ],
            'valid_id' => [
                'document_code' => 'valid_id',
                'document_name' => 'Valid Government ID',
                'description' => 'Government-issued identity document.',
                'has_expiration' => true,
                'validity_period' => null,
                'required_fields' => ['document_number', 'expiration_date'],
                'grace_period_days' => 30,
            ],
            'lease_contract' => [
                'document_code' => 'lease_contract',
                'document_name' => 'Notarized Lease Contract',
                'description' => 'Lease agreement for rented commercial space.',
                'has_expiration' => true,
                'validity_period' => 'Contract Term',
                'required_fields' => ['registered_name', 'issue_date', 'expiration_date'],
                'grace_period_days' => 30,
            ],
            'transfer_certificate_title' => [
                'document_code' => 'transfer_certificate_title',
                'document_name' => 'Transfer Certificate of Title (TCT)',
                'description' => 'Land title for owned property.',
                'has_expiration' => false,
                'validity_period' => null,
                'required_fields' => ['document_number', 'registered_name'],
                'grace_period_days' => 30,
            ],
            'building_plans' => [
                'document_code' => 'building_plans',
                'document_name' => 'Approved Building Plans',
                'description' => 'LGU-approved structural engineering and architecture plans.',
                'has_expiration' => false,
                'validity_period' => null,
                'required_fields' => ['document_number', 'issue_date'],
                'grace_period_days' => 30,
            ],
            'health_permit' => [
                'document_code' => 'health_permit',
                'document_name' => 'Health Permit',
                'description' => 'Health office operational clearance.',
                'has_expiration' => true,
                'validity_period' => '1 Year',
                'required_fields' => ['document_number', 'issue_date', 'expiration_date'],
                'grace_period_days' => 30,
            ],
            'diving_permit' => [
                'document_code' => 'diving_permit',
                'document_name' => 'Diving Permit / Certification',
                'description' => 'PCSSD or LGU permit for diving operations.',
                'has_expiration' => true,
                'validity_period' => '1 Year',
                'required_fields' => ['document_number', 'issue_date', 'expiration_date'],
                'grace_period_days' => 30,
            ],
            'event_permit' => [
                'document_code' => 'event_permit',
                'document_name' => 'Special Event Permit',
                'description' => 'LGU permit for hosting gatherings and events.',
                'has_expiration' => true,
                'validity_period' => '1 Year',
                'required_fields' => ['document_number', 'issue_date', 'expiration_date'],
                'grace_period_days' => 30,
            ],
            'farm_tourism_accreditation' => [
                'document_code' => 'farm_tourism_accreditation',
                'document_name' => 'Farm Tourism Accreditation',
                'description' => 'Department of Agriculture / DOT farm tourism accreditation.',
                'has_expiration' => true,
                'validity_period' => '2 Years',
                'required_fields' => ['document_number', 'issue_date', 'expiration_date'],
                'grace_period_days' => 60,
            ],
        ];

        $commonDocCodes = ['dti_certificate', 'bir_certificate', 'barangay_clearance', 'mayors_permit', 'fire_safety'];

        $categoryMappings = [
            'Hotel' => [
                'required' => ['dti_certificate', 'bir_certificate', 'barangay_clearance', 'mayors_permit', 'fire_safety', 'occupancy_permit', 'sanitary_permit', 'health_permit', 'dot_accreditation'],
                'optional' => ['building_plans', 'lease_contract', 'transfer_certificate_title', 'sec_registration'],
            ],
            'Resort' => [
                'required' => ['dti_certificate', 'bir_certificate', 'barangay_clearance', 'mayors_permit', 'fire_safety', 'occupancy_permit', 'sanitary_permit', 'health_permit', 'dot_accreditation', 'environmental_compliance'],
                'optional' => ['building_plans', 'lease_contract', 'transfer_certificate_title', 'sec_registration'],
            ],
            'Hotel & Restaurant Combination' => [
                'required' => ['dti_certificate', 'bir_certificate', 'barangay_clearance', 'mayors_permit', 'fire_safety', 'occupancy_permit', 'sanitary_permit', 'health_permit', 'health_certificates', 'food_safety', 'dot_accreditation'],
                'optional' => ['building_plans', 'lease_contract', 'transfer_certificate_title', 'sec_registration'],
            ],
            'Restaurant' => [
                'required' => ['dti_certificate', 'bir_certificate', 'barangay_clearance', 'mayors_permit', 'fire_safety', 'occupancy_permit', 'sanitary_permit', 'health_certificates', 'food_safety', 'health_permit'],
                'optional' => ['building_plans', 'lease_contract', 'sec_registration'],
            ],
            'Café' => [
                'required' => ['dti_certificate', 'bir_certificate', 'barangay_clearance', 'mayors_permit', 'fire_safety', 'occupancy_permit', 'sanitary_permit', 'health_certificates', 'food_safety', 'health_permit'],
                'optional' => ['lease_contract', 'sec_registration'],
            ],
            'Food Hub' => [
                'required' => ['dti_certificate', 'bir_certificate', 'barangay_clearance', 'mayors_permit', 'fire_safety', 'occupancy_permit', 'sanitary_permit', 'health_certificates', 'food_safety', 'health_permit'],
                'optional' => ['building_plans', 'lease_contract', 'sec_registration'],
            ],
            'Tourist Attraction' => [
                'required' => ['dti_certificate', 'bir_certificate', 'barangay_clearance', 'mayors_permit', 'fire_safety', 'dot_accreditation', 'environmental_compliance', 'occupancy_permit'],
                'optional' => ['building_plans', 'sec_registration'],
            ],
            'Tour Guide' => [
                'required' => ['dti_certificate', 'bir_certificate', 'barangay_clearance', 'mayors_permit', 'tourism_accreditation', 'valid_id', 'health_permit'],
                'optional' => ['dot_accreditation'],
            ],
            'Travel Agency' => [
                'required' => ['dti_certificate', 'bir_certificate', 'barangay_clearance', 'mayors_permit', 'fire_safety', 'dot_accreditation'],
                'optional' => ['sec_registration', 'lease_contract'],
            ],
            'Souvenir Shop' => [
                'required' => ['dti_certificate', 'bir_certificate', 'barangay_clearance', 'mayors_permit', 'fire_safety'],
                'optional' => ['occupancy_permit', 'lease_contract'],
            ],
            'Transport Service' => [
                'required' => ['dti_certificate', 'bir_certificate', 'barangay_clearance', 'mayors_permit', 'fire_safety', 'ltfrb_certificate', 'vehicle_registration'],
                'optional' => ['valid_id', 'sec_registration'],
            ],
            'Homestay' => [
                'required' => ['dti_certificate', 'bir_certificate', 'barangay_clearance', 'mayors_permit', 'fire_safety', 'sanitary_permit', 'health_permit', 'dot_accreditation'],
                'optional' => ['occupancy_permit', 'lease_contract', 'transfer_certificate_title'],
            ],
            'Camping Site' => [
                'required' => ['dti_certificate', 'bir_certificate', 'barangay_clearance', 'mayors_permit', 'fire_safety', 'environmental_compliance', 'dot_accreditation'],
                'optional' => ['occupancy_permit', 'lease_contract'],
            ],
            'Dive Shop' => [
                'required' => ['dti_certificate', 'bir_certificate', 'barangay_clearance', 'mayors_permit', 'fire_safety', 'diving_permit', 'dot_accreditation'],
                'optional' => ['occupancy_permit', 'lease_contract', 'sec_registration'],
            ],
            'Event Venue' => [
                'required' => ['dti_certificate', 'bir_certificate', 'barangay_clearance', 'mayors_permit', 'fire_safety', 'event_permit', 'occupancy_permit', 'sanitary_permit'],
                'optional' => ['building_plans', 'lease_contract'],
            ],
            'Farm Tourism' => [
                'required' => ['dti_certificate', 'bir_certificate', 'barangay_clearance', 'mayors_permit', 'fire_safety', 'farm_tourism_accreditation', 'environmental_compliance', 'dot_accreditation'],
                'optional' => ['occupancy_permit', 'lease_contract'],
            ],
        ];

        $categories = BusinessCategory::all();

        foreach ($categories as $category) {
            $mapping = $categoryMappings[$category->name] ?? null;
            if (!$mapping) {
                // Fallback for any unknown category
                $mapping = [
                    'required' => $commonDocCodes,
                    'optional' => [],
                ];
            }

            $order = 0;
            $allDocs = array_unique(array_merge($mapping['required'], $mapping['optional']));

            foreach ($allDocs as $docCode) {
                if (!isset($templates[$docCode])) {
                    continue;
                }

                $tpl = $templates[$docCode];
                $isRequired = in_array($docCode, $mapping['required']);

                RequiredDocument::create([
                    'business_category_id' => $category->id,
                    'document_name' => $tpl['document_name'],
                    'document_code' => $tpl['document_code'],
                    'is_required' => $isRequired,
                    'has_expiration' => $tpl['has_expiration'],
                    'validity_period' => $tpl['validity_period'],
                    'description' => $tpl['description'],
                    'required_fields' => $tpl['required_fields'],
                    'is_active' => true,
                    'sort_order' => $order++,
                    'grace_period_days' => $tpl['grace_period_days'],
                    'effective_date' => now(),
                ]);
            }
        }
    }
}
