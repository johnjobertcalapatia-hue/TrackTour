<?php

namespace Tests\Feature;

use Tests\TestCase;

class CorsConfigurationTest extends TestCase
{
    public function test_vercel_frontend_is_allowed_to_preflight_public_api_routes(): void
    {
        $origin = 'https://tracktour-frontend.vercel.app';

        foreach ([
            '/api/landing/cards',
            '/api/landing-content',
            '/api/map/businesses',
            '/api/municipalities',
        ] as $uri) {
            $response = $this->withHeaders([
                'Origin' => $origin,
                'Access-Control-Request-Method' => 'GET',
            ])->options($uri);

            $response->assertNoContent();
            $response->assertHeader('Access-Control-Allow-Origin', $origin);
        }
    }

    public function test_unapproved_origin_is_not_granted_cors_access(): void
    {
        $response = $this->withHeaders([
            'Origin' => 'https://unapproved.example',
            'Access-Control-Request-Method' => 'GET',
        ])->options('/api/landing/cards');

        $response->assertNoContent();
        $this->assertFalse($response->headers->has('Access-Control-Allow-Origin'));
    }
}
