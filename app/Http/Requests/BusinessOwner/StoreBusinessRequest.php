<?php

namespace App\Http\Requests\BusinessOwner;

use Illuminate\Foundation\Http\FormRequest;

class StoreBusinessRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'business_name' => ['required', 'string', 'max:255'],
            'business_description' => ['required', 'string', 'max:2000'],
            'business_category_id' => ['required', 'exists:business_categories,id'],
            'municipality_id' => ['required', 'exists:municipalities,id'],
            'barangay_id' => ['required', 'exists:barangays,id'],
            'address' => ['required', 'string', 'max:500'],
            'contact_number' => ['required', 'string', 'max:20'],
            'email' => ['required', 'email'],
            'website' => ['nullable', 'url'],
            'facebook' => ['nullable', 'url'],
            'instagram' => ['nullable', 'url'],
            'tagline' => ['nullable', 'string', 'max:255'],
            'other_social_media' => ['nullable', 'string', 'max:500'],
            'postal_code' => ['nullable', 'string', 'max:10'],
            'landmark' => ['nullable', 'string', 'max:255'],
            'navigation_instructions' => ['nullable', 'string', 'max:1000'],
            'opening_time' => ['required', 'date_format:H:i'],
            'closing_time' => ['required', 'date_format:H:i', 'after:opening_time'],
            'business_days' => ['required', 'array'],
            'latitude' => ['required', 'numeric'],
            'longitude' => ['required', 'numeric'],
            'legal_entity_type' => ['required', 'string', 'in:Sole Proprietorship,Partnership,Corporation,OPC'],
            'tin' => ['required', 'string', 'max:20'],
            'dti_sec_reg_number' => ['nullable', 'string', 'max:50'],
            'year_established' => ['required', 'integer', 'min:1900', 'max:' . date('Y')],
            'initial_capital' => ['nullable', 'numeric', 'min:0'],
            'gross_floor_area' => ['nullable', 'numeric', 'min:0'],
            'number_of_employees' => ['nullable', 'integer', 'min:0'],
            'occupancy_status' => ['nullable', 'string', 'in:Owned,Rented'],
            'building_number' => ['nullable', 'string', 'max:50'],
            'documents' => ['nullable', 'array'],
            'documents.*.required_document_id' => ['nullable', 'integer', 'exists:required_documents,id'],
            'documents.*.file' => ['required_with:documents', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
            'documents.*.document_number' => ['nullable', 'string', 'max:255'],
            'documents.*.registered_name' => ['nullable', 'string', 'max:255'],
            'documents.*.issue_date' => ['nullable', 'date'],
            'documents.*.expiration_date' => ['nullable', 'date'],
            'documents.*.ocr_document_number' => ['nullable', 'string', 'max:255'],
            'documents.*.ocr_registered_name' => ['nullable', 'string', 'max:255'],
            'documents.*.ocr_issue_date' => ['nullable', 'string', 'max:50'],
            'documents.*.ocr_expiration_date' => ['nullable', 'string', 'max:50'],
            'details' => ['nullable', 'array'],
            'logo' => ['nullable', 'file', 'mimes:jpg,jpeg,png', 'max:5120'],
            'gallery' => ['nullable', 'array', 'max:9'],
            'gallery.*' => ['file', 'mimes:jpg,jpeg,png', 'max:5120'],
        ];
    }

    public function messages(): array
    {
        return [
            'business_name.required' => 'Business name is required.',
            'business_name.max' => 'Business name must not exceed 255 characters.',
            'business_description.required' => 'Business description is required.',
            'business_description.max' => 'Business description must not exceed 2000 characters.',
            'business_category_id.required' => 'Business category is required.',
            'business_category_id.exists' => 'Selected business category does not exist.',
            'municipality_id.required' => 'Municipality is required.',
            'municipality_id.exists' => 'Selected municipality does not exist.',
            'barangay_id.required' => 'Barangay is required.',
            'barangay_id.exists' => 'Selected barangay does not exist.',
            'address.required' => 'Address is required.',
            'address.max' => 'Address must not exceed 500 characters.',
            'contact_number.required' => 'Contact number is required.',
            'contact_number.max' => 'Contact number must not exceed 20 characters.',
            'email.required' => 'Email address is required.',
            'email.email' => 'Please enter a valid email address.',
            'website.url' => 'Please enter a valid website URL.',
            'facebook.url' => 'Please enter a valid Facebook URL.',
            'instagram.url' => 'Please enter a valid Instagram URL.',
            'opening_time.required' => 'Opening time is required.',
            'opening_time.date_format' => 'Opening time must be in HH:MM format.',
            'closing_time.required' => 'Closing time is required.',
            'closing_time.date_format' => 'Closing time must be in HH:MM format.',
            'closing_time.after' => 'Closing time must be after opening time.',
            'business_days.required' => 'Business days are required.',
            'business_days.array' => 'Business days must be an array.',
            'latitude.required' => 'Latitude is required.',
            'latitude.numeric' => 'Latitude must be numeric.',
            'longitude.required' => 'Longitude is required.',
            'longitude.numeric' => 'Longitude must be numeric.',
            'legal_entity_type.required' => 'Legal entity type is required.',
            'legal_entity_type.in' => 'Legal entity type must be Sole Proprietorship, Partnership, Corporation, or OPC.',
            'tin.required' => 'Tax Identification Number (TIN) is required.',
            'tin.max' => 'TIN must not exceed 20 characters.',
            'year_established.required' => 'Year established is required.',
            'year_established.integer' => 'Year established must be a valid year.',
            'year_established.min' => 'Year established must be 1900 or later.',
            'initial_capital.numeric' => 'Initial capital must be a number.',
            'gross_floor_area.numeric' => 'Gross floor area must be a number.',
            'number_of_employees.integer' => 'Number of employees must be a whole number.',
            'occupancy_status.in' => 'Occupancy status must be Owned or Rented.',
        ];
    }
}
