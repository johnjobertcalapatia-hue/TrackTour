<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class UserFactory extends Factory
{
    protected static ?string $password;

    public function definition(): array
    {
        return [
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'password' => static::$password ??= Hash::make('password'),
            'remember_token' => Str::random(10),
            'role' => User::ROLE_TOURIST,
            'account_status' => User::ACCOUNT_STATUS_APPROVED,
        ];
    }

    public function unverified(): static
    {
        return $this->state(fn (array $attributes) => [
            'email_verified_at' => null,
        ]);
    }

    public function businessOwner(): static
    {
        return $this->state(fn (array $attributes) => [
            'role' => User::ROLE_BUSINESS_OWNER,
            'account_status' => User::ACCOUNT_STATUS_PENDING,
        ])->afterCreating(function (User $user) {
            $user->profile()->create([
                'first_name' => fake()->firstName(),
                'last_name' => fake()->lastName(),
                'nationality' => 'Filipino',
                'mobile_number' => fake()->phoneNumber(),
            ]);
        });
    }
}
