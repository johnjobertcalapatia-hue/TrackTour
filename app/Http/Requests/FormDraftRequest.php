<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class FormDraftRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'draft_key' => 'required|string|max:100',
            'form_id' => 'required|string|max:100',
            'fields' => 'required|array',
            'fields.*' => 'nullable',
            'ui_state' => 'nullable|array',
            'version' => 'nullable|integer|min:1',
            'expires_at' => 'nullable|date',
        ];
    }
}
