<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RegistrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_registration_screen_redirects_to_the_spa(): void
    {
        $response = $this->get('/register?role='.User::ROLE_TOURIST);

        $response->assertRedirect(
            config('app.frontend_url').'/register?role='.User::ROLE_TOURIST
        );
    }

    public function test_new_users_can_register(): void
    {
        $response = $this->post('/register', [
            'email' => 'test@example.com',
            'password' => 'TestPass123!',
            'password_confirmation' => 'TestPass123!',
            'role' => User::ROLE_TOURIST,
            'first_name' => 'Test',
            'last_name' => 'User',
            'date_of_birth' => '2000-01-01',
            'mobile_number' => '09171234567',
        ]);

        $response->assertSessionHasNoErrors();
        $this->assertAuthenticated();
        $response->assertRedirect(route('home', absolute: false));
    }
}
