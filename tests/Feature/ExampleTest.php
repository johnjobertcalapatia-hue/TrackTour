<?php

namespace Tests\Feature;

use Tests\TestCase;

class ExampleTest extends TestCase
{
    public function test_the_api_root_returns_a_json_service_response(): void
    {
        $this->get('/')
            ->assertOk()
            ->assertJson(['service' => 'TrackTour API']);
    }

    public function test_the_health_endpoint_remains_available(): void
    {
        $this->get('/up')->assertOk();
    }

    public function test_the_api_does_not_catch_unknown_frontend_routes(): void
    {
        $this->get('/some-client-route')->assertNotFound();
    }
}
