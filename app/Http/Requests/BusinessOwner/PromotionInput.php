<?php

namespace App\Http\Requests\BusinessOwner;

use Illuminate\Validation\Rule;

/**
 * Promotion fields shared by create and update. The page's names
 * (discount_type, discount_value, start_date, end_date) and the API's original
 * names (discount_percentage, valid_from, valid_until) both work. A promotion is
 * shown to tourists as "20% OFF" or "₱100 OFF"; it does not change checkout
 * prices.
 */
final class PromotionInput
{
    /** @return array<string, mixed> canonical keys added from the aliases */
    public static function normalize(array $input): array
    {
        $out = [];
        $out['discount_type'] = $input['discount_type'] ?? 'percentage';
        if (! isset($input['discount_value']) && isset($input['discount_percentage'])) {
            $out['discount_value'] = $input['discount_percentage'];
        }
        if (! isset($input['valid_from']) && isset($input['start_date'])) {
            $out['valid_from'] = $input['start_date'];
        }
        if (! isset($input['valid_until']) && isset($input['end_date'])) {
            $out['valid_until'] = $input['end_date'];
        }

        return $out;
    }

    public static function rules(): array
    {
        return [
            'description' => ['nullable', 'string', 'max:1000'],
            'discount_type' => ['required', 'in:percentage,fixed'],
            // A percentage is at most 100; a fixed peso amount at most 100,000.
            'discount_value' => ['required', 'numeric', 'min:0.01', Rule::when(
                fn ($input) => ($input->discount_type ?? 'percentage') === 'percentage',
                ['max:100'],
                ['max:100000']
            )],
            'valid_from' => ['required', 'date'],
            'valid_until' => ['required', 'date', 'after_or_equal:valid_from'],
        ];
    }

    public static function messages(): array
    {
        return [
            'title.required' => 'Enter a promotion title.',
            'discount_value.required' => 'Enter the discount.',
            'discount_value.min' => 'The discount must be more than 0.',
            'discount_value.max' => 'The discount is too large (a percentage cannot be more than 100%).',
            'valid_from.required' => 'Choose a start date.',
            'valid_until.required' => 'Choose an end date.',
            'valid_until.after_or_equal' => 'The end date cannot be before the start date.',
        ];
    }
}
