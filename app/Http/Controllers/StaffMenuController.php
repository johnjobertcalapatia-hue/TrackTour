<?php

namespace App\Http\Controllers;

use App\Models\Offering;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class StaffMenuController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $staff = $request->staff;
        $business = $staff->business;

        $categories = $business->offeringCategories()
            ->withCount('offerings')
            ->orderBy('sort_order')
            ->get();

        $offerings = $business->offerings()
            ->with('category')
            ->orderBy('sort_order')
            ->latest()
            ->get();

        return $this->successResponse(compact('business', 'categories', 'offerings'));
    }

    public function getCategories(Request $request): JsonResponse
    {
        $staff = $request->staff;
        $categories = $staff->business->offeringCategories()->orderBy('sort_order')->get(['id', 'name']);

        return response()->json($categories);
    }

    public function store(Request $request): RedirectResponse
    {
        $staff = $request->staff;
        $business = $staff->business;

        $validated = $request->validate([
            'offering_category_id' => ['required', 'integer', 'exists:offering_categories,id'],
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:5000'],
            'price' => ['required', 'numeric', 'min:0'],
            'compare_price' => ['nullable', 'numeric', 'min:0'],
            'status' => ['required', 'string', 'in:available,unavailable'],
            'has_variations' => ['nullable', 'boolean'],
            'image' => ['nullable', 'file', 'mimes:jpg,jpeg,png,webp', 'max:2048'],
            'images' => ['nullable', 'array'],
            'images.*' => ['file', 'mimes:jpg,jpeg,png,webp', 'max:2048'],
            'new_category' => ['nullable', 'string', 'max:255'],
            'stock' => ['nullable', 'integer', 'min:0'],
            'unlimited_stock' => ['nullable', 'boolean'],
            'variation_groups' => ['nullable', 'array'],
            'variation_groups.*.name' => ['required_with:variation_groups', 'string', 'max:255'],
            'variation_groups.*.required' => ['nullable', 'boolean'],
            'variation_groups.*.options' => ['required_with:variation_groups', 'array', 'min:1'],
            'variation_groups.*.options.*.name' => ['required_with:variation_groups', 'string', 'max:255'],
            'variation_groups.*.options.*.price_adjustment' => ['nullable', 'numeric', 'min:0'],
            'addon_groups' => ['nullable', 'array'],
            'addon_groups.*.name' => ['required_with:addon_groups', 'string', 'max:255'],
            'addon_groups.*.required' => ['nullable', 'boolean'],
            'addon_groups.*.items' => ['required_with:addon_groups', 'array', 'min:1'],
            'addon_groups.*.items.*.name' => ['required_with:addon_groups', 'string', 'max:255'],
            'addon_groups.*.items.*.price' => ['required_with:addon_groups', 'numeric', 'min:0'],
        ]);

        if (! empty($validated['new_category'])) {
            $cat = $business->offeringCategories()->create(['name' => $validated['new_category']]);
            $validated['offering_category_id'] = $cat->id;
        }

        $hasVariations = ! empty($validated['variation_groups']);

        DB::beginTransaction();

        try {
            $offering = $business->offerings()->create([
                'offering_category_id' => $validated['offering_category_id'],
                'name' => $validated['name'],
                'description' => $validated['description'] ?? null,
                'price' => $validated['price'],
                'compare_price' => $validated['compare_price'] ?? null,
                'status' => $validated['status'],
                'is_available' => $validated['status'] === 'available',
                'has_variations' => $hasVariations,
                'stock' => ! empty($validated['unlimited_stock']) ? 0 : ($validated['stock'] ?? 0),
                'type' => 'product',
            ]);

            if ($request->hasFile('image')) {
                $path = $request->file('image')->store('offerings', 'public');
                $offering->update(['image' => $path]);
            }

            if ($request->hasFile('images')) {
                $paths = [];
                foreach ($request->file('images') as $file) {
                    $paths[] = $file->store('offerings', 'public');
                }
                $offering->update(['images' => $paths]);
            }

            if ($hasVariations) {
                foreach ($validated['variation_groups'] as $gi => $groupData) {
                    $group = $offering->variationGroups()->create([
                        'name' => $groupData['name'],
                        'required' => ! empty($groupData['required']),
                        'min_select' => ! empty($groupData['required']) ? 1 : 0,
                        'max_select' => 1,
                        'sort_order' => $gi,
                    ]);

                    foreach ($groupData['options'] as $oi => $optionData) {
                        $group->options()->create([
                            'name' => $optionData['name'],
                            'price_adjustment' => $optionData['price_adjustment'] ?? 0,
                            'sort_order' => $oi,
                        ]);
                    }
                }
            }

            if (! empty($validated['addon_groups'])) {
                foreach ($validated['addon_groups'] as $gi => $groupData) {
                    $group = $offering->addonGroups()->create([
                        'name' => $groupData['name'],
                        'required' => ! empty($groupData['required']),
                        'min_select' => 0,
                        'max_select' => 0,
                        'sort_order' => $gi,
                    ]);

                    foreach ($groupData['items'] as $itemData) {
                        $group->items()->create([
                            'name' => $itemData['name'],
                            'price' => $itemData['price'],
                            'sort_order' => 0,
                        ]);
                    }
                }
            }

            DB::commit();

            return redirect()->route('staff.menu.index')
                ->with('success', 'Menu item created successfully.');

        } catch (\Exception $e) {
            DB::rollBack();

            return back()->withInput()->with('error', 'Failed to create menu item: '.$e->getMessage());
        }
    }

    public function update(Request $request, Offering $offering): RedirectResponse
    {
        $staff = $request->staff;
        if ($offering->business_id !== $staff->business_id) {
            abort(403);
        }

        $validated = $request->validate([
            'offering_category_id' => ['required', 'integer', 'exists:offering_categories,id'],
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:5000'],
            'price' => ['required', 'numeric', 'min:0'],
            'compare_price' => ['nullable', 'numeric', 'min:0'],
            'status' => ['required', 'string', 'in:available,unavailable'],
            'has_variations' => ['nullable', 'boolean'],
            'image' => ['nullable', 'file', 'mimes:jpg,jpeg,png,webp', 'max:2048'],
            'stock' => ['nullable', 'integer', 'min:0'],
            'unlimited_stock' => ['nullable', 'boolean'],
            'variation_groups' => ['nullable', 'array'],
            'variation_groups.*.name' => ['required_with:variation_groups', 'string', 'max:255'],
            'variation_groups.*.required' => ['nullable', 'boolean'],
            'variation_groups.*.options' => ['required_with:variation_groups', 'array', 'min:1'],
            'variation_groups.*.options.*.name' => ['required_with:variation_groups', 'string', 'max:255'],
            'variation_groups.*.options.*.price_adjustment' => ['nullable', 'numeric', 'min:0'],
            'addon_groups' => ['nullable', 'array'],
            'addon_groups.*.name' => ['required_with:addon_groups', 'string', 'max:255'],
            'addon_groups.*.required' => ['nullable', 'boolean'],
            'addon_groups.*.items' => ['required_with:addon_groups', 'array', 'min:1'],
            'addon_groups.*.items.*.name' => ['required_with:addon_groups', 'string', 'max:255'],
            'addon_groups.*.items.*.price' => ['required_with:addon_groups', 'numeric', 'min:0'],
        ]);

        $hasVariations = ! empty($validated['variation_groups']);

        DB::beginTransaction();

        try {
            $offering->update([
                'offering_category_id' => $validated['offering_category_id'],
                'name' => $validated['name'],
                'description' => $validated['description'] ?? null,
                'price' => $validated['price'],
                'compare_price' => $validated['compare_price'] ?? null,
                'status' => $validated['status'],
                'is_available' => $validated['status'] === 'available',
                'has_variations' => $hasVariations,
                'stock' => ! empty($validated['unlimited_stock']) ? 0 : ($validated['stock'] ?? 0),
            ]);

            if ($request->hasFile('image')) {
                $path = $request->file('image')->store('offerings', 'public');
                $offering->update(['image' => $path]);
            }

            // Sync variations
            $offering->variationGroups()->delete();
            if ($hasVariations) {
                foreach ($validated['variation_groups'] as $gi => $groupData) {
                    $group = $offering->variationGroups()->create([
                        'name' => $groupData['name'],
                        'required' => ! empty($groupData['required']),
                        'min_select' => ! empty($groupData['required']) ? 1 : 0,
                        'max_select' => 1,
                        'sort_order' => $gi,
                    ]);
                    foreach ($groupData['options'] as $oi => $optionData) {
                        $group->options()->create([
                            'name' => $optionData['name'],
                            'price_adjustment' => $optionData['price_adjustment'] ?? 0,
                            'sort_order' => $oi,
                        ]);
                    }
                }
            }

            // Sync add-ons
            $offering->addonGroups()->delete();
            if (! empty($validated['addon_groups'])) {
                foreach ($validated['addon_groups'] as $gi => $groupData) {
                    $group = $offering->addonGroups()->create([
                        'name' => $groupData['name'],
                        'required' => ! empty($groupData['required']),
                        'min_select' => 0,
                        'max_select' => 0,
                        'sort_order' => $gi,
                    ]);
                    foreach ($groupData['items'] as $itemData) {
                        $group->items()->create([
                            'name' => $itemData['name'],
                            'price' => $itemData['price'],
                            'sort_order' => 0,
                        ]);
                    }
                }
            }

            DB::commit();

            return redirect()->route('staff.menu.index')
                ->with('success', 'Menu item updated successfully.');

        } catch (\Exception $e) {
            DB::rollBack();

            return back()->withInput()->with('error', 'Failed to update menu item: '.$e->getMessage());
        }
    }

    public function destroy(Request $request, Offering $offering): RedirectResponse
    {
        $staff = $request->staff;
        if ($offering->business_id !== $staff->business_id) {
            abort(403);
        }

        $offering->update(['status' => 'hidden', 'is_available' => false]);

        return redirect()->route('staff.menu.index')
            ->with('success', 'Menu item hidden.');
    }

    public function toggleStatus(Request $request, Offering $offering): RedirectResponse
    {
        $staff = $request->staff;
        if ($offering->business_id !== $staff->business_id) {
            abort(403);
        }

        $newStatus = $offering->status === 'available' ? 'unavailable' : 'available';
        $offering->update([
            'status' => $newStatus,
            'is_available' => $newStatus === 'available',
        ]);

        return back()->with('success', 'Status updated.');
    }

    public function duplicate(Request $request, Offering $offering): RedirectResponse
    {
        $staff = $request->staff;
        if ($offering->business_id !== $staff->business_id) {
            abort(403);
        }

        $clone = $offering->replicate();
        $clone->name = $offering->name.' (Copy)';
        $clone->status = 'hidden';
        $clone->is_available = false;
        $clone->save();

        return redirect()->route('staff.menu.edit', $clone)
            ->with('success', 'Item duplicated. Edit and save when ready.');
    }
}
