<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BusinessResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->business_name,
            'business_name' => $this->business_name,
            'description' => $this->business_description,
            'business_description' => $this->business_description,
            'tagline' => $this->tagline,
            'business_category_id' => $this->business_category_id,
            'category' => $this->whenLoaded('category', fn () => $this->category->name),
            'category_data' => new BusinessCategoryResource($this->whenLoaded('category')),
            'municipality_id' => $this->municipality_id,
            'municipality' => $this->whenLoaded('municipality', fn () => $this->municipality->name),
            'municipality_data' => new MunicipalityResource($this->whenLoaded('municipality')),
            'barangay_id' => $this->barangay_id,
            'barangay' => $this->whenLoaded('barangay', fn () => $this->barangay->name),
            'barangay_data' => new BarangayResource($this->whenLoaded('barangay')),
            'address' => $this->address,
            'landmark' => $this->landmark,
            'phone' => $this->contact_number,
            'contact_number' => $this->contact_number,
            'email' => $this->email,
            'website' => $this->website,
            'facebook' => $this->facebook,
            'instagram' => $this->instagram,
            'other_social_media' => $this->other_social_media,
            'logo' => $this->logo,
            'cover_photo' => $this->cover_photo,
            'status' => $this->status,
            'latitude' => $this->latitude,
            'longitude' => $this->longitude,
            'opening_time' => $this->opening_time,
            'closing_time' => $this->closing_time,
            'business_days' => $this->business_days,
            'business_hours' => $this->business_hours,
            'price_range' => $this->price_range,
            'accepts_reservation' => $this->accepts_reservation,
            'facilities' => $this->facilities,
            'services' => $this->services,
            'payment_methods' => $this->payment_methods,
            'average_rating' => $this->average_rating,
            'review_count' => $this->review_count,
            'favorite_count' => $this->favorite_count,
            'booking_count' => $this->booking_count,
            'is_open' => $this->isOpenNow(),
            'is_open_now' => $this->isOpenNow(),
            'is_accepting_orders' => $this->isAcceptingOrders(),
            'availability' => $this->availability(),
            'open_status' => $this->openStatusLabel(),
            'schedule_summary' => $this->scheduleSummary(),
            'welcome_message' => $this->welcome_message,
            'signature_dishes' => $this->asStringArray($this->signature_dishes),
            'featured_menu_items' => $this->asIntArray($this->featured_menu_items),
            'featured_promotions' => $this->asIntArray($this->featured_promotions),
            'restaurant_profile' => $this->restaurant_profile,
            'force_closed' => $this->force_closed,
            'owner' => new UserResource($this->whenLoaded('owner')),
            'media' => BusinessMediaResource::collection($this->whenLoaded('media')),
            'details' => $this->whenLoaded('details', fn () => $this->details->mapWithKeys(
                fn ($detail) => [$detail->field_name => $detail->field_value]
            )),
            'documents' => BusinessDocumentResource::collection($this->whenLoaded('documents')),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }

    protected function asIntArray(mixed $value): array
    {
        if (is_array($value)) {
            return array_values(array_filter(array_map(fn ($v) => (int) $v, $value)));
        }
        if (is_string($value) && $value !== '') {
            $decoded = json_decode($value, true);
            if (is_array($decoded)) {
                return array_values(array_filter(array_map(fn ($v) => (int) $v, $decoded)));
            }
            return array_values(array_filter(array_map('intval', preg_split('/[,\s]+/', $value))));
        }
        return [];
    }

    protected function asStringArray(mixed $value): array
    {
        if (is_array($value)) {
            return array_values(array_filter(array_map('strval', $value)));
        }
        if (is_string($value) && $value !== '') {
            $decoded = json_decode($value, true);
            if (is_array($decoded)) {
                return array_values(array_filter(array_map('strval', $decoded)));
            }
            return array_values(array_filter(preg_split('/[,\s]+/', $value)));
        }
        return $value === null ? [] : [$value];
    }
}
