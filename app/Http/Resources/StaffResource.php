<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class StaffResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'user' => new UserResource($this->whenLoaded('user')),
            'business' => new BusinessResource($this->whenLoaded('business')),
            'employee_id' => $this->employee_id,
            'name' => $this->full_name,
            'email' => $this->whenLoaded('user', fn () => $this->user->email),
            'middle_name' => $this->middle_name,
            'suffix' => $this->suffix,
            'gender' => $this->gender,
            'date_of_birth' => $this->date_of_birth,
            'mobile_number' => $this->mobile_number,
            'address' => $this->address,
            'profile_picture' => $this->profile_picture_url,
            'staff_role' => new StaffRoleResource($this->whenLoaded('staffRole')),
            'role_label' => $this->staffRole?->name,
            'display_role' => $this->staffRole?->name ?? ucfirst($this->status),
            'is_active' => $this->status === 'active',
            'status' => $this->status,
            'status_label' => $this->status_label,
            'status_color' => $this->status_color,
            'permissions' => $this->module_permissions,
            'date_hired' => $this->date_hired,
            'salary_type' => $this->salary_type,
            'employment_status' => $this->employment_status,
            'last_login_at' => $this->last_login_at,
            'two_factor_enabled' => $this->two_factor_enabled,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
            'deleted_at' => $this->deleted_at,
        ];
    }
}
