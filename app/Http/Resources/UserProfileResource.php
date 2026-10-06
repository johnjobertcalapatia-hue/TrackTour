<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserProfileResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'first_name' => $this->first_name,
            'middle_name' => $this->middle_name,
            'last_name' => $this->last_name,
            'suffix' => $this->suffix,
            'avatar' => $this->avatar,
            'phone' => $this->mobile_number,
            'address' => $this->address,
            'sex' => $this->sex,
            'nationality' => $this->nationality,
            'date_of_birth' => $this->date_of_birth,
        ];
    }
}
