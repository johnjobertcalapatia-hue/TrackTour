<?php

namespace App\Services;

class DocumentExtractor
{
    private array $templates = [
        'business_permit' => [
            'label' => 'Business Permit',
            'patterns' => [
                'permit_number' => [
                    '/Permit\s*(?:No|Number)\.?\s*:?\s*([A-Za-z0-9\-]+)/i',
                    '/Business\s*Permit\s*(?:No|Number)\.?\s*:?\s*([A-Za-z0-9\-]+)/i',
                    '/BPL\s*(?:No|Number)\.?\s*:?\s*([A-Za-z0-9\-]+)/i',
                ],
                'business_name' => [
                    '/Business\s*Name\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                    '/Name\s*of\s*Business\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                ],
                'owner_name' => [
                    '/Owner\s*:?\s*([A-Za-z\s\.\']+)/i',
                    '/Proprietor\s*:?\s*([A-Za-z\s\.\']+)/i',
                    '/Permittee\s*:?\s*([A-Za-z\s\.\']+)/i',
                ],
                'business_address' => [
                    '/Business\s*Address\s*:?\s*([A-Za-z0-9\s,\.\-\#\/]+)/i',
                    '/Address\s*:?\s*([A-Za-z0-9\s,\.\-\#\/]+)/i',
                ],
                'business_type' => [
                    '/Business\s*Type\s*:?\s*([A-Za-z0-9\s&]+)/i',
                    '/Nature\s*of\s*Business\s*:?\s*([A-Za-z0-9\s&]+)/i',
                    '/Type\s*of\s*Business\s*:?\s*([A-Za-z0-9\s&]+)/i',
                ],
                'issue_date' => [
                    '/Date\s*(?:Issued|of\s*Issue|Approved)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                    '/Issued\s*(?:on|date)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                ],
                'expiry_date' => [
                    '/Expir(?:y|ation)\s*Date\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                    '/Valid\s*(?:until|thru)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                ],
                'issuing_authority' => [
                    '/Issuing\s*Authority\s*:?\s*([A-Za-z0-9\s,\.]+)/i',
                    '/(Republic\s*of\s*the\s*Philippines[\s\S]{0,100}?(?:City|Municipality|Province))/i',
                    '/(Local\s*Government\s*Unit[\s\S]{0,50}?(?:City|Municipality))/i',
                ],
            ],
        ],
        'dti' => [
            'label' => 'DTI Certificate',
            'patterns' => [
                'registration_number' => [
                    '/Registration\s*(?:No|Number)\.?\s*:?\s*([A-Za-z0-9\-]+)/i',
                    '/DTI\s*(?:Reg|Registration)\.?\s*(?:No|Number)\.?\s*:?\s*([A-Za-z0-9\-]+)/i',
                    '/Reg\s*(?:No|Number)\.?\s*:?\s*(\d+)/i',
                ],
                'business_name' => [
                    '/Business\s*Name\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                    '/Registered\s*Business\s*Name\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                    '/Name\s*of\s*Business\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                ],
                'owner_name' => [
                    '/Owner\s*:?\s*([A-Za-z\s\.\']+)/i',
                    '/Business\s*Owner\s*:?\s*([A-Za-z\s\.\']+)/i',
                    '/\bOwner\b\s*\n\s*([A-Za-z\s\.\']+)/i',
                ],
                'business_scope' => [
                    '/Scope\s*of\s*Business\s*:?\s*([A-Za-z0-9\s,]+)/i',
                    '/Business\s*Scope\s*:?\s*([A-Za-z0-9\s,]+)/i',
                ],
                'issue_date' => [
                    '/Date\s*(?:Issued|of\s*Registration|Approved)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                    '/Issued\s*(?:on|date)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                ],
                'expiry_date' => [
                    '/Expir(?:y|ation)\s*Date\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                    '/Valid\s*(?:until|thru)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                ],
                'business_address' => [
                    '/Business\s*Address\s*:?\s*([A-Za-z0-9\s,\.\-\#\/]+)/i',
                    '/Address\s*:?\s*([A-Za-z0-9\s,\.\-\#\/]+)/i',
                ],
            ],
        ],
        'sec' => [
            'label' => 'SEC Registration',
            'patterns' => [
                'sec_registration_number' => [
                    '/SEC\s*(?:Reg|Registration)\.?\s*(?:No|Number)\.?\s*:?\s*([A-Za-z0-9\-]+)/i',
                    '/Registration\s*(?:No|Number)\.?\s*:?\s*([A-Za-z0-9\-]+)/i',
                    '/(?:CN|FN|RN)\d{4}[-\/]\d{6,}/',
                ],
                'company_name' => [
                    '/Company\s*Name\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                    '/Corporate\s*Name\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                    '/Name\s*of\s*Corporation\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                ],
                'company_type' => [
                    '/Company\s*Type\s*:?\s*([A-Za-z0-9\s]+)/i',
                    '/Type\s*of\s*Company\s*:?\s*([A-Za-z0-9\s]+)/i',
                    '/(?:Stock|Non[- ]?Stock)\s*Corporation/i',
                ],
                'authorized_representative' => [
                    '/Authorized\s*Representative\s*:?\s*([A-Za-z\s\.\']+)/i',
                    '/President\s*:?\s*([A-Za-z\s\.\']+)/i',
                    '/Corporate\s*Secretary\s*:?\s*([A-Za-z\s\.\']+)/i',
                ],
                'issue_date' => [
                    '/Date\s*(?:Issued|of\s*Registration|Incorporation)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                    '/Issued\s*(?:on|date)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                    '/Incorporated\s*(?:on|date)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                ],
                'principal_office_address' => [
                    '/Principal\s*(?:Office|Address)\s*:?\s*([A-Za-z0-9\s,\.\-\#\/]+)/i',
                    '/Office\s*Address\s*:?\s*([A-Za-z0-9\s,\.\-\#\/]+)/i',
                    '/Registered\s*Address\s*:?\s*([A-Za-z0-9\s,\.\-\#\/]+)/i',
                ],
            ],
        ],
        'bir_cor' => [
            'label' => 'BIR Certificate of Registration (2303)',
            'patterns' => [
                'tin' => [
                    '/TIN\s*:?\s*(\d{3}[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3})/i',
                    '/TIN\s*:?\s*(\d{3}[\s-]?\d{3}[\s-]?\d{3})/i',
                    '/(\d{3}[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3})/',
                ],
                'registered_name' => [
                    '/Registered\s*Name\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                    '/Business\s*Name\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                    '/Taxpayer\s*Name\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                ],
                'registered_address' => [
                    '/Registered\s*Address\s*:?\s*([A-Za-z0-9\s,\.\-\#\/]+)/i',
                    '/Address\s*:?\s*([A-Za-z0-9\s,\.\-\#\/]+)/i',
                ],
                'line_of_business' => [
                    '/Line\s*of\s*Business\s*:?\s*([A-Za-z0-9\s&,\-]+)/i',
                    '/Nature\s*of\s*Business\s*:?\s*([A-Za-z0-9\s&,\-]+)/i',
                    '/Business\s*Type\s*:?\s*([A-Za-z0-9\s&,\-]+)/i',
                ],
                'issue_date' => [
                    '/Date\s*(?:Issued|of\s*Registration)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                    '/Issued\s*(?:on|date)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                    '/Registration\s*Date\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                ],
            ],
        ],
        'owner_valid_id' => [
            'label' => 'Owner Valid ID',
            'patterns' => [
                'full_name' => [
                    '/Name\s*:?\s*([A-Za-z\s\.\']+)/i',
                    '/Full\s*Name\s*:?\s*([A-Za-z\s\.\']+)/i',
                    '/Holder\s*:?\s*([A-Za-z\s\.\']+)/i',
                ],
                'id_type' => [
                    '/(?:Government\s*)?(?:Issued\s*)?(?:ID|Identification|License)[\s\S]{0,30}?(?:Passport|Driver|National|PhilHealth|SSS|GSIS|UMID|Postal|Voter|PRC|TIN)/i',
                    '/(Passport|Driver\s*\'?s?\s*License|National\s*ID|PhilHealth|SSS|GSIS|UMID|Postal\s*ID|Voter\s*\'?s?\s*ID|PRC\s*ID|TIN\s*ID)/i',
                ],
                'id_number' => [
                    '/ID\s*(?:No|Number)\.?\s*:?\s*([A-Za-z0-9\-]+)/i',
                    '/(?:No|Number)\.?\s*:?\s*([A-Za-z0-9\-]{5,})/i',
                    '/License\s*(?:No|Number)\.?\s*:?\s*([A-Za-z0-9\-]+)/i',
                ],
                'date_of_birth' => [
                    '/DOB\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                    '/Date\s*of\s*Birth\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                    '/Birth\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                ],
                'address' => [
                    '/Address\s*:?\s*([A-Za-z0-9\s,\.\-\#\/]+)/i',
                ],
                'expiry_date' => [
                    '/Expir(?:y|ation)\s*Date\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                    '/Valid\s*(?:until|thru)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                ],
            ],
        ],
        'sanitary_permit' => [
            'label' => 'Sanitary Permit',
            'patterns' => [
                'business_name' => [
                    '/Business\s*Name\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                    '/Establishment\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                    '/Name\s*of\s*Establishment\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                ],
                'owner_name' => [
                    '/Owner\s*:?\s*([A-Za-z\s\.\']+)/i',
                    '/Proprietor\s*:?\s*([A-Za-z\s\.\']+)/i',
                ],
                'document_number' => [
                    '/Permit\s*(?:No|Number)\.?\s*:?\s*([A-Za-z0-9\-]+)/i',
                    '/Sanitary\s*Permit\s*(?:No|Number)\.?\s*:?\s*([A-Za-z0-9\-]+)/i',
                    '/SP\s*(?:No|Number)\.?\s*:?\s*([A-Za-z0-9\-]+)/i',
                ],
                'issue_date' => [
                    '/Date\s*(?:Issued|of\s*Issue)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                    '/Issued\s*(?:on|date)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                ],
                'expiry_date' => [
                    '/Expir(?:y|ation)\s*Date\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                    '/Valid\s*(?:until|thru)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                ],
            ],
        ],
        'fsic' => [
            'label' => 'FSIC / Fire Safety Certificate',
            'patterns' => [
                'business_name' => [
                    '/Business\s*Name\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                    '/Name\s*of\s*Establishment\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                    '/Establishment\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                ],
                'owner_name' => [
                    '/Owner\s*:?\s*([A-Za-z\s\.\']+)/i',
                    '/Applicant\s*:?\s*([A-Za-z\s\.\']+)/i',
                ],
                'document_number' => [
                    '/Certificate\s*(?:No|Number)\.?\s*:?\s*([A-Za-z0-9\-]+)/i',
                    '/FSIC\s*(?:No|Number)\.?\s*:?\s*([A-Za-z0-9\-]+)/i',
                    '/FSIC\s*[:\-]\s*([A-Za-z0-9\-]+)/i',
                ],
                'issue_date' => [
                    '/Date\s*(?:Issued|of\s*Issue)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                    '/Issued\s*(?:on|date)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                ],
                'expiry_date' => [
                    '/Expir(?:y|ation)\s*Date\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                    '/Valid\s*(?:until|thru)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
                ],
            ],
        ],
    ];

    public function getTemplates(): array
    {
        return $this->templates;
    }

    public function getTemplateKeys(): array
    {
        return array_keys($this->templates);
    }

    public function detectDocumentType(string $text): ?string
    {
        $scores = [];

        foreach ($this->templates as $key => $template) {
            $score = 0;
            foreach ($template['patterns'] as $field => $patterns) {
                foreach ($patterns as $pattern) {
                    if (preg_match($pattern, $text)) {
                        $score++;
                        break;
                    }
                }
            }
            $scores[$key] = $score;
        }

        arsort($scores);
        $best = key($scores);

        return $scores[$best] > 0 ? $best : null;
    }

    public function extract(string $text, ?string $documentType = null): array
    {
        $result = [
            'detected_type' => null,
            'detected_label' => null,
            'fields' => [],
            'raw_text' => $text,
        ];

        if (!$documentType) {
            $documentType = $this->detectDocumentType($text);
        }

        if (!$documentType || !isset($this->templates[$documentType])) {
            $result['fields'] = $this->fallbackExtract($text);
            return $result;
        }

        $result['detected_type'] = $documentType;
        $result['detected_label'] = $this->templates[$documentType]['label'];

        foreach ($this->templates[$documentType]['patterns'] as $field => $patterns) {
            foreach ($patterns as $pattern) {
                if (preg_match($pattern, $text, $matches)) {
                    $value = trim($matches[1] ?? $matches[0]);
                    $value = preg_replace('/\s+/', ' ', $value);
                    $result['fields'][$field] = $value;
                    break;
                }
            }
        }

        return $result;
    }

    private function fallbackExtract(string $text): array
    {
        $fields = [];

        $patterns = [
            'business_name' => [
                '/Business\s*Name\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
                '/Name\s*:?\s*([A-Za-z0-9\s&\.,\'\-]+)/i',
            ],
            'owner_name' => [
                '/Owner\s*:?\s*([A-Za-z\s\.\']+)/i',
                '/Name\s*of\s*Owner\s*:?\s*([A-Za-z\s\.\']+)/i',
            ],
            'document_number' => [
                '/(?:No|Number)\.?\s*:?\s*([A-Za-z0-9\-]{4,})/i',
                '/[A-Z]{2,5}[\s-]?\d{3,}/',
            ],
            'tin' => [
                '/(\d{3}[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3,})/',
            ],
            'issue_date' => [
                '/([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4})/',
                '/(\d{1,2}\/\d{1,2}\/\d{4})/',
                '/(\d{4}-\d{2}-\d{2})/',
            ],
            'expiry_date' => [
                '/(?:Expir|Valid)\s*(?:y|ation|until|thru)\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i',
            ],
        ];

        foreach ($patterns as $field => $regexes) {
            foreach ($regexes as $pattern) {
                if (preg_match($pattern, $text, $matches)) {
                    $value = trim($matches[1] ?? $matches[0]);
                    $value = preg_replace('/\s+/', ' ', $value);
                    $fields[$field] = $value;
                    break;
                }
            }
        }

        return $fields;
    }
}
