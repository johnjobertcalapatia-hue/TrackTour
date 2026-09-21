<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;

class OfferingResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $categoryData = null;
        if ($this->relationLoaded('category')) {
            $catRelation = $this->getRelation('category');
            $categoryData = $catRelation ? OfferingCategoryResource::make($catRelation) : null;
        } elseif (is_object($this->category)) {
            $categoryData = OfferingCategoryResource::make($this->category);
        } else {
            $categoryData = $this->category;
        }

        return [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'price' => $this->price,
            'compare_price' => $this->compare_price,
            'unit' => $this->unit,
            'stock' => $this->stock,
            'status' => $this->status ?? ($this->is_available ? 'available' : 'unavailable'),
            'category' => $categoryData,
            'is_available' => $this->is_available,
            'is_featured' => $this->bestseller,
            'has_variations' => $this->has_variations,
            'variations' => $this->relationLoaded('variations')
                ? $this->variations->map(fn ($v) => [
                    'id' => $v->id,
                    'name' => $v->name,
                    'price' => $v->price,
                    'compare_price' => $v->compare_price,
                    'image' => $v->image ? Storage::url($v->image) : null,
                    'is_available' => $v->is_available,
                    'sort_order' => $v->sort_order,
                ])
                : [],
            'image' => $this->image ? Storage::url($this->image) : null,
            'images' => array_map(fn ($img) => Storage::url($img), $this->images ?? []),
            'type' => $this->type ?? $this->offering_type ?? 'product',
            'business_name' => $this->business?->business_name,
            'sort_order' => $this->sort_order,
            'sales_count' => $this->orders_count,
            'revenue' => $this->revenue,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
