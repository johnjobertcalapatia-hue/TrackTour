<?php

namespace App\Http\Controllers;

use App\Enums\PriceRange;
use App\Models\Barangay;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\RequiredDocument;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
class BusinessRegistrationController extends Controller
{
    public function store(Request $request): RedirectResponse
    {
        $user = $request->user();

        $rules = [
            'category_id' => ['required', 'integer', 'exists:business_categories,id'],
            'business_name' => ['required', 'string', 'max:255'],
            'business_description' => ['required', 'string', 'max:5000'],
            'tagline' => ['nullable', 'string', 'max:255'],
            'contact_number' => ['required', 'string', 'max:20'],
            'email' => ['required', 'email', 'max:255'],
            'website' => ['nullable', 'string', 'max:255'],
            'facebook' => ['nullable', 'string', 'max:255'],
            'instagram' => ['nullable', 'string', 'max:255'],
            'other_social_media' => ['nullable', 'string', 'max:500'],
            'municipality_id' => ['required', 'integer', 'exists:municipalities,id'],
            'barangay_id' => ['required', 'integer', 'exists:barangays,id'],
            'address' => ['nullable', 'string', 'max:500'],
            'building_number' => ['nullable', 'string', 'max:50'],
            'postal_code' => ['nullable', 'string', 'max:10'],
            'landmark' => ['nullable', 'string', 'max:255'],
            'navigation_instructions' => ['nullable', 'string', 'max:1000'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'legal_entity_type' => ['nullable', 'string', 'in:Sole Proprietorship,Partnership,Corporation,Cooperative'],
            'tin' => ['nullable', 'string', 'max:20'],
            'dti_sec_reg_number' => ['nullable', 'string', 'max:50'],
            'year_established' => ['nullable', 'integer', 'min:1900', 'max:' . date('Y')],
            'opening_date' => ['nullable', 'date'],
            'number_of_employees' => ['nullable', 'integer', 'min:0'],
            'business_size' => ['nullable', 'string', 'in:Micro,Small,Medium,Large'],
            'gross_floor_area' => ['nullable', 'numeric', 'min:0'],
            'initial_capital' => ['nullable', 'numeric', 'min:0'],
            'ownership_status' => ['nullable', 'string', 'in:Owned,Leased,Rented'],
            'opening_time' => ['nullable', 'string'],
            'closing_time' => ['nullable', 'string'],
            'business_days' => ['nullable', 'array'],
            'business_days.*' => ['string', 'in:monday,tuesday,wednesday,thursday,friday,saturday,sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday'],
            'holiday_schedule' => ['nullable', 'string', 'max:2000'],
            'price_range' => ['nullable', 'string', 'in:budget,affordable,mid_range,premium,luxury'],
            'dining_style' => ['nullable', 'array'],
            'accepts_reservation' => ['nullable', 'boolean'],
            'reservation_required' => ['nullable', 'boolean'],
            'average_wait_time' => ['nullable', 'integer', 'min:0'],
            'facilities' => ['nullable', 'array'],
            'services' => ['nullable', 'array'],
            'payment_methods' => ['nullable', 'array'],
            'details' => ['nullable', 'array'],
            'special_offers' => ['nullable', 'string', 'max:2000'],
            'documents' => ['nullable', 'array'],
            'documents.*.required_document_id' => ['required_with:documents', 'integer', 'exists:required_documents,id'],
            'documents.*.file' => ['required_with:documents', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
            'documents.*.document_number' => ['nullable', 'string', 'max:255'],
            'documents.*.registered_name' => ['nullable', 'string', 'max:255'],
            'documents.*.issued_by' => ['nullable', 'string', 'max:255'],
            'documents.*.issue_date' => ['nullable', 'date'],
            'documents.*.expiration_date' => ['nullable', 'date', 'after_or_equal:issue_date'],
            'documents.*.owner_remarks' => ['nullable', 'string', 'max:1000'],
            'logo' => ['nullable', 'file', 'mimes:jpg,jpeg,png', 'max:2048'],
            'cover_photo' => ['nullable', 'file', 'mimes:jpg,jpeg,png', 'max:5120'],
            'gallery' => ['nullable', 'array'],
            'gallery.*' => ['file', 'mimes:jpg,jpeg,png', 'max:5120'],
            'promotional_video' => ['nullable', 'file', 'mimes:mp4,avi,mov', 'max:102400'],
        ];

        $validated = $request->validate($rules);

        // Validate that all required documents for the category are present
        $category = BusinessCategory::find($validated['category_id']);
        if ($category) {
            $requiredDocIds = $category->requiredDocuments()->where('is_required', true)->where('is_active', true)->whereNull('archived_at')->pluck('id')->toArray();
            if (! empty($requiredDocIds)) {
                if (empty($validated['documents'])) {
                    return back()->withErrors([
                        'documents' => 'The documents field is required for this category.',
                    ])->withInput();
                }
                $submittedIds = array_column($validated['documents'], 'required_document_id');
                $missingIds = array_diff($requiredDocIds, $submittedIds);
                if (! empty($missingIds)) {
                    $missingNames = RequiredDocument::whereIn('id', $missingIds)->pluck('document_name')->toArray();

                    return back()->withErrors([
                        'documents' => 'Missing required documents: '.implode(', ', $missingNames),
                    ])->withInput();
                }
            }
        }

        // Normalize business_days to lowercase
        if (! empty($validated['business_days'])) {
            $validated['business_days'] = array_map('strtolower', $validated['business_days']);
        }

        try {
            DB::beginTransaction();

            $business = $user->businesses()->create([
                'business_category_id' => $validated['category_id'],
                'business_name' => $validated['business_name'],
                'business_description' => $validated['business_description'] ?? null,
                'tagline' => $validated['tagline'] ?? null,
                'contact_number' => $validated['contact_number'] ?? null,
                'email' => $validated['email'] ?? null,
                'website' => $validated['website'] ?? null,
                'facebook' => $validated['facebook'] ?? null,
                'instagram' => $validated['instagram'] ?? null,
                'other_social_media' => $validated['other_social_media'] ?? null,
                'municipality_id' => $validated['municipality_id'],
                'barangay_id' => $validated['barangay_id'],
                'address' => $validated['address'] ?? null,
                'building_number' => $validated['building_number'] ?? null,
                'postal_code' => $validated['postal_code'] ?? null,
                'landmark' => $validated['landmark'] ?? null,
                'navigation_instructions' => $validated['navigation_instructions'] ?? null,
                'latitude' => $validated['latitude'] ?? null,
                'longitude' => $validated['longitude'] ?? null,
                'legal_entity_type' => $validated['legal_entity_type'] ?? null,
                'tin' => $validated['tin'] ?? null,
                'dti_sec_reg_number' => $validated['dti_sec_reg_number'] ?? null,
                'year_established' => $validated['year_established'] ?? null,
                'opening_date' => $validated['opening_date'] ?? null,
                'number_of_employees' => $validated['number_of_employees'] ?? null,
                'business_size' => $validated['business_size'] ?? null,
                'gross_floor_area' => $validated['gross_floor_area'] ?? null,
                'initial_capital' => $validated['initial_capital'] ?? null,
                'ownership_status' => $validated['ownership_status'] ?? null,
                'opening_time' => $validated['opening_time'] ?? null,
                'closing_time' => $validated['closing_time'] ?? null,
                'business_days' => $validated['business_days'] ?? null,
                'holiday_schedule' => $validated['holiday_schedule'] ?? null,
                'price_range' => $validated['price_range'] ?? null,
                'dining_style' => $validated['dining_style'] ?? null,
                'accepts_reservation' => $validated['accepts_reservation'] ?? false,
                'reservation_required' => $validated['reservation_required'] ?? false,
                'average_wait_time' => $validated['average_wait_time'] ?? null,
                'facilities' => $validated['facilities'] ?? null,
                'services' => $validated['services'] ?? null,
                'payment_methods' => $validated['payment_methods'] ?? null,
                'special_offers' => $validated['special_offers'] ?? null,
                'status' => 'under_review',
            ]);

            $business->syncModulesFromCategory();

            // Store EAV details
            if (! empty($validated['details'])) {
                $detailData = [];
                foreach ($validated['details'] as $fieldName => $fieldValue) {
                    if (! is_null($fieldValue) && $fieldValue !== '') {
                        $detailData[] = [
                            'business_id' => $business->id,
                            'field_name' => $fieldName,
                            'field_value' => is_array($fieldValue) ? json_encode($fieldValue) : $fieldValue,
                        ];
                    }
                }
                if (! empty($detailData)) {
                    $business->details()->createMany($detailData);
                }
            }

            // Media uploads
            $sortOrder = 0;
            if ($request->hasFile('logo')) {
                $business->media()->create([
                    'type' => 'Logo',
                    'file_path' => $request->file('logo')->store('businesses/logos', 'public'),
                    'sort_order' => $sortOrder++,
                ]);
            }

            if ($request->hasFile('cover_photo')) {
                $business->media()->create([
                    'type' => 'Cover Photo',
                    'file_path' => $request->file('cover_photo')->store('businesses/covers', 'public'),
                    'sort_order' => $sortOrder++,
                ]);
            }

            if ($request->hasFile('gallery')) {
                foreach ($request->file('gallery') as $image) {
                    $business->media()->create([
                        'type' => 'Gallery',
                        'file_path' => $image->store('businesses/gallery', 'public'),
                        'sort_order' => $sortOrder++,
                    ]);
                }
            }

            if ($request->hasFile('promotional_video')) {
                $business->media()->create([
                    'type' => 'Promotional Video',
                    'file_path' => $request->file('promotional_video')->store('businesses/videos', 'public'),
                ]);
            }

            // Documents
            if (! empty($validated['documents'])) {
                foreach ($validated['documents'] as $doc) {
                    $filePath = null;
                    if (! empty($doc['file']) && $doc['file'] instanceof UploadedFile) {
                        $filePath = $doc['file']->store('businesses/documents', 'local');
                    }
                    $business->documents()->create([
                        'required_document_id' => $doc['required_document_id'],
                        'file_path' => $filePath,
                        'document_number' => $doc['document_number'] ?? null,
                        'registered_name' => $doc['registered_name'] ?? null,
                        'issued_by' => $doc['issued_by'] ?? null,
                        'issue_date' => $doc['issue_date'] ?? null,
                        'expiration_date' => $doc['expiration_date'] ?? null,
                        'owner_remarks' => $doc['owner_remarks'] ?? null,
                        'verification_status' => 'pending',
                    ]);
                }
            }

            $business->statusLogs()->create([
                'status' => 'pending',
                'remarks' => 'Business registration submitted for review',
            ]);

            DB::commit();

            $request->session()->forget('business_registration');

            return redirect()->route('business-owner.businesses')
                ->with('success', 'Your business has been registered successfully! It is now pending review by the Tourism Office.');

        } catch (\Exception $e) {
            DB::rollBack();
            \Log::error('Business registration failed: '.$e->getMessage(), [
                'user_id' => $user->id,
                'trace' => $e->getTraceAsString(),
            ]);

            return back()->with('error', 'An error occurred while saving your business. Please try again.')->withInput();
        }
    }

    public function saveStep(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'step' => ['nullable', 'string'],
            'data' => ['required', 'array'],
            'current_step' => ['nullable', 'integer', 'min:1', 'max:10'],
        ]);

        $key = 'business_registration';
        $session = $request->session()->get($key, []);

        if ($validated['step']) {
            $session[$validated['step']] = $validated['data'];
        }

        if ($validated['current_step']) {
            $session['current_step'] = $validated['current_step'];
        }

        $request->session()->put($key, $session);

        return response()->json(['success' => true]);
    }

    public function getSessionData(Request $request): JsonResponse
    {
        return response()->json(
            $request->session()->get('business_registration', [
                'category' => [],
                'basic_information' => [],
                'details' => [],
                'location' => [],
                'operating_information' => [],
                'restaurant_details' => [],
                'facilities' => [],
                'services' => [],
                'documents' => [],
                'gallery' => [],
                'current_step' => 1,
            ])
        );
    }

    public function getDocumentRequirements(Request $request): JsonResponse
    {
        $categoryId = $request->input('category_id');
        if (! $categoryId) {
            return $this->successResponse(['documents' => []]);
        }

        $category = BusinessCategory::find($categoryId);
        if (! $category) {
            return $this->successResponse(['documents' => []]);
        }

        $docs = $category->requiredDocuments()
            ->where('is_active', true)
            ->whereNull('archived_at')
            ->orderBy('sort_order')
            ->get()
            ->map(fn ($doc) => [
                'id' => $doc->id,
                'key' => $doc->document_code,
                'label' => $doc->document_name,
                'purpose' => $doc->description,
                'required' => (bool) $doc->is_required,
                'has_expiration' => (bool) $doc->has_expiration,
                'is_expirable' => (bool) $doc->has_expiration, // for backwards compatibility
                'validity_period' => $doc->validity_period,
                'required_fields' => $doc->required_fields ?? ['document_number', 'issue_date', 'expiration_date'],
                'grace_period_days' => $doc->grace_period_days,
                'sort_order' => $doc->sort_order,
                'accept' => '.pdf,.jpg,.jpeg,.png',
                'max_size' => 5120,
            ])->values()->toArray();

        return $this->successResponse(['documents' => $docs]);
    }

    public function getCategoryDocuments(int $categoryId): JsonResponse
    {
        $category = BusinessCategory::find($categoryId);
        if (! $category) {
            return $this->successResponse([]);
        }

        $docs = $category->requiredDocuments()
            ->where('is_active', true)
            ->whereNull('archived_at')
            ->orderBy('sort_order')
            ->get();

        return $this->successResponse($docs);
    }

    public function getBarangays(int $municipalityId): JsonResponse
    {
        $barangays = Barangay::where('municipality_id', $municipalityId)
            ->orderBy('name')
            ->get(['id', 'name']);

        return $this->successResponse($barangays);
    }

    public function getCategoryFields(int $categoryId): JsonResponse
    {
        $fields = $this->getFieldsForCategory($categoryId);

        return $this->successResponse($fields);
    }

    private function getFieldsForCategory(int $categoryId): array
    {
        $fields = [
            1 => [ // Hotel
                ['key' => 'property_type', 'label' => 'Property Type', 'type' => 'select', 'options' => ['Hotel', 'Resort', 'Tourist Inn', 'Apartel', 'Boutique Hotel', 'Motel']],
                ['key' => 'hotel_classification', 'label' => 'Star Classification', 'type' => 'select', 'options' => ['1-Star', '2-Star', '3-Star', '4-Star', '5-Star', 'Boutique', 'Budget', 'Unclassified']],
                ['key' => 'number_of_rooms', 'label' => 'Number of Rooms', 'type' => 'number'],
                ['key' => 'number_of_floors', 'label' => 'Number of Floors', 'type' => 'number'],
                ['key' => 'check_in_time', 'label' => 'Check-in Time', 'type' => 'time'],
                ['key' => 'check_out_time', 'label' => 'Check-out Time', 'type' => 'time'],
                ['key' => 'parking_slots', 'label' => 'Parking Slots', 'type' => 'number'],
                ['key' => 'swimming_pool', 'label' => 'Swimming Pool Available', 'type' => 'boolean'],
                ['key' => 'restaurant_seating', 'label' => 'Restaurant Seating Capacity', 'type' => 'number'],
                ['key' => 'conference_capacity', 'label' => 'Conference Room Capacity', 'type' => 'number'],
                ['key' => 'amenities', 'label' => 'Amenities & Facilities', 'type' => 'textarea', 'placeholder' => 'e.g., Free Wi-Fi, Air Conditioning, 24/7 Front Desk, Airport Shuttle, Room Service, Gym'],
                ['key' => 'year_built', 'label' => 'Year Built', 'type' => 'number'],
            ],
            2 => [ // Resort
                ['key' => 'resort_type', 'label' => 'Resort Type', 'type' => 'select', 'options' => ['Beach Resort', 'Mountain Resort', 'Lake Resort', 'Spring Resort', 'Private Resort']],
                ['key' => 'day_tour_available', 'label' => 'Day Tour Available', 'type' => 'boolean'],
                ['key' => 'overnight_stay', 'label' => 'Overnight Stay', 'type' => 'boolean'],
                ['key' => 'number_of_cottages', 'label' => 'Number of Cottages', 'type' => 'number'],
                ['key' => 'number_of_rooms', 'label' => 'Number of Rooms', 'type' => 'number'],
                ['key' => 'swimming_pool', 'label' => 'Swimming Pool', 'type' => 'boolean'],
                ['key' => 'beach_access', 'label' => 'Beach Access', 'type' => 'boolean'],
                ['key' => 'parking', 'label' => 'Parking', 'type' => 'boolean'],
                ['key' => 'recreational_activities', 'label' => 'Recreational Activities', 'type' => 'textarea', 'placeholder' => 'List available activities'],
            ],
            3 => [ // Hotel & Restaurant Combination
                ['key' => 'property_type', 'label' => 'Property Type', 'type' => 'select', 'options' => ['Hotel with Restaurant', 'Resort with Restaurant', 'Inn with Restaurant']],
                ['key' => 'number_of_rooms', 'label' => 'Number of Rooms', 'type' => 'number'],
                ['key' => 'number_of_restaurants', 'label' => 'Number of Restaurants', 'type' => 'number'],
                ['key' => 'restaurant_seating', 'label' => 'Restaurant Seating Capacity', 'type' => 'number'],
                ['key' => 'check_in_time', 'label' => 'Check-in Time', 'type' => 'time'],
                ['key' => 'check_out_time', 'label' => 'Check-out Time', 'type' => 'time'],
                ['key' => 'parking_slots', 'label' => 'Parking Slots', 'type' => 'number'],
                ['key' => 'swimming_pool', 'label' => 'Swimming Pool Available', 'type' => 'boolean'],
                ['key' => 'amenities', 'label' => 'Amenities & Facilities', 'type' => 'textarea', 'placeholder' => 'e.g., Free Wi-Fi, Air Conditioning, Restaurant, Bar'],
            ],
            4 => [ // Restaurant
                ['key' => 'seating_capacity', 'label' => 'Seating Capacity', 'type' => 'number', 'required' => true],
                ['key' => 'service_type', 'label' => 'Service Type', 'type' => 'select', 'options' => ['Full-Service Restaurant', 'Fine Dining', 'Casual Dining', 'Fast Food', 'Buffet', 'Food Stall', 'Family Style', 'Food Truck', 'Carinderia'], 'required' => true],
                ['key' => 'cuisine_type', 'label' => 'Cuisine Types', 'type' => 'multi_checkbox', 'options' => ['Filipino', 'Asian', 'Seafood', 'International', 'Fast Food', 'Desserts', 'Beverages', 'Chinese', 'Japanese', 'Korean', 'American', 'Italian', 'Mexican', 'Vegetarian', 'Vegan', 'Fusion'], 'required' => true],
                ['key' => 'dining_facilities', 'label' => 'Dining Facilities', 'type' => 'multi_checkbox', 'options' => ['Indoor Dining', 'Outdoor Dining', 'Private Dining Room', 'Bar Area', 'Function Area']],
                ['key' => 'available_services', 'label' => 'Available Services', 'type' => 'multi_checkbox', 'options' => ['Dine-in', 'Take-out', 'Delivery', 'Catering', 'Online Ordering', 'Reservation']],
                ['key' => 'indoor_seating_count', 'label' => 'Indoor Seating Count', 'type' => 'number'],
                ['key' => 'outdoor_seating_count', 'label' => 'Outdoor Seating Count', 'type' => 'number'],
                ['key' => 'max_guests_per_reservation', 'label' => 'Max Guests per Reservation', 'type' => 'number'],
            ],
            5 => [ // Café
                ['key' => 'coffee_specialty', 'label' => 'Coffee Specialty', 'type' => 'text', 'placeholder' => 'e.g., Barista Coffee, Brewed'],
                ['key' => 'cuisine_type', 'label' => 'Cuisine/Specialty Types', 'type' => 'multi_checkbox', 'options' => ['Coffee', 'Tea', 'Pastries', 'Brunch', 'Desserts', 'Light Meals', 'Vegan', 'Specialty Drinks']],
                ['key' => 'indoor_seating_count', 'label' => 'Indoor Seating', 'type' => 'number'],
                ['key' => 'outdoor_seating_count', 'label' => 'Outdoor Seating', 'type' => 'number'],
                ['key' => 'total_seating', 'label' => 'Total Seating Capacity', 'type' => 'number'],
            ],
            6 => [ // Food Hub / Food Park
                ['key' => 'number_of_stalls', 'label' => 'Number of Stalls', 'type' => 'number'],
                ['key' => 'cuisine_type', 'label' => 'Food Types', 'type' => 'multi_checkbox', 'options' => ['Filipino', 'Asian', 'Western', 'Seafood', 'Grilled', 'Desserts', 'Drinks', 'International']],
                ['key' => 'total_seating', 'label' => 'Total Seating Capacity', 'type' => 'number'],
                ['key' => 'entertainment', 'label' => 'Live Entertainment', 'type' => 'boolean'],
            ],
            7 => [ // Tourist Attraction
                ['key' => 'attraction_type', 'label' => 'Attraction Type', 'type' => 'select', 'options' => ['Natural', 'Historical', 'Cultural', 'Adventure', 'Religious', 'Man-made']],
                ['key' => 'entrance_fee', 'label' => 'Entrance Fee', 'type' => 'text', 'placeholder' => 'e.g., PHP 50 per person'],
                ['key' => 'guided_tour_available', 'label' => 'Guided Tour Available', 'type' => 'boolean'],
                ['key' => 'estimated_visit_duration', 'label' => 'Estimated Visit Duration', 'type' => 'text', 'placeholder' => 'e.g., 2-3 hours'],
            ],
            8 => [ // Tour Guide
                ['key' => 'languages_spoken', 'label' => 'Languages Spoken', 'type' => 'text', 'placeholder' => 'e.g., English, Tagalog'],
                ['key' => 'guide_license_number', 'label' => 'Guide License Number', 'type' => 'text'],
                ['key' => 'years_of_experience', 'label' => 'Years of Experience', 'type' => 'number'],
                ['key' => 'tour_types', 'label' => 'Tour Types', 'type' => 'text', 'placeholder' => 'e.g., Historical, Nature, Food'],
                ['key' => 'maximum_guests', 'label' => 'Maximum Guests per Tour', 'type' => 'number'],
            ],
            9 => [ // Travel Agency
                ['key' => 'accreditation_number', 'label' => 'Accreditation Number', 'type' => 'text'],
                ['key' => 'services_offered', 'label' => 'Services Offered', 'type' => 'textarea', 'placeholder' => 'List services offered'],
                ['key' => 'domestic_tours', 'label' => 'Domestic Tours', 'type' => 'boolean'],
                ['key' => 'international_tours', 'label' => 'International Tours', 'type' => 'boolean'],
            ],
            10 => [ // Souvenir Shop
                ['key' => 'offering_categories', 'label' => 'Offering Categories', 'type' => 'textarea', 'placeholder' => 'e.g., Handicrafts, T-shirts, Local food'],
                ['key' => 'local_products_available', 'label' => 'Local Products Available', 'type' => 'boolean'],
            ],
            11 => [ // Transport Service
                ['key' => 'vehicle_type', 'label' => 'Vehicle Type', 'type' => 'select', 'options' => ['Van', 'SUV', 'Sedan', 'Tricycle', 'Jeepney', 'Bus', 'Boat', 'Bicycle']],
                ['key' => 'number_of_vehicles', 'label' => 'Number of Vehicles', 'type' => 'number'],
                ['key' => 'passenger_capacity', 'label' => 'Passenger Capacity', 'type' => 'number'],
                ['key' => 'routes_covered', 'label' => 'Routes Covered', 'type' => 'textarea', 'placeholder' => 'List routes covered'],
            ],
            12 => [ // Homestay
                ['key' => 'number_of_guest_rooms', 'label' => 'Number of Guest Rooms', 'type' => 'number'],
                ['key' => 'maximum_guests', 'label' => 'Maximum Guests', 'type' => 'number'],
                ['key' => 'breakfast_included', 'label' => 'Breakfast Included', 'type' => 'boolean'],
                ['key' => 'family_friendly', 'label' => 'Family Friendly', 'type' => 'boolean'],
            ],
            13 => [ // Camping Site
                ['key' => 'camping_capacity', 'label' => 'Camping Capacity', 'type' => 'number'],
                ['key' => 'tent_rental', 'label' => 'Tent Rental', 'type' => 'boolean'],
                ['key' => 'cottage_rental', 'label' => 'Cottage Rental', 'type' => 'boolean'],
                ['key' => 'bonfire_area', 'label' => 'Bonfire Area', 'type' => 'boolean'],
                ['key' => 'comfort_rooms', 'label' => 'Comfort Rooms', 'type' => 'boolean'],
                ['key' => 'parking', 'label' => 'Parking', 'type' => 'boolean'],
            ],
            14 => [ // Dive Shop
                ['key' => 'dive_types', 'label' => 'Dive Types', 'type' => 'text', 'placeholder' => 'e.g., Scuba, Snorkeling, Free diving'],
                ['key' => 'equipment_rental', 'label' => 'Equipment Rental', 'type' => 'boolean'],
                ['key' => 'dive_courses', 'label' => 'Dive Courses Offered', 'type' => 'text', 'placeholder' => 'e.g., Open Water, Advanced'],
                ['key' => 'maximum_divers', 'label' => 'Maximum Divers per Trip', 'type' => 'number'],
            ],
            15 => [ // Event Venue
                ['key' => 'venue_capacity', 'label' => 'Venue Capacity', 'type' => 'number'],
                ['key' => 'indoor_space', 'label' => 'Indoor Space Available', 'type' => 'boolean'],
                ['key' => 'outdoor_space', 'label' => 'Outdoor Space Available', 'type' => 'boolean'],
                ['key' => 'parking_capacity', 'label' => 'Parking Capacity', 'type' => 'number'],
                ['key' => 'catering_available', 'label' => 'In-House Catering', 'type' => 'boolean'],
            ],
            16 => [ // Farm Tourism
                ['key' => 'farm_activities', 'label' => 'Farm Activities', 'type' => 'textarea', 'placeholder' => 'List available activities'],
                ['key' => 'accommodation_available', 'label' => 'Accommodation Available', 'type' => 'boolean'],
                ['key' => 'farm_size', 'label' => 'Farm Size', 'type' => 'text', 'placeholder' => 'e.g., 5 hectares'],
                ['key' => 'products_available', 'label' => 'Products Available', 'type' => 'textarea', 'placeholder' => 'List products for sale'],
            ],
        ];

        return $fields[$categoryId] ?? [];
    }
}
