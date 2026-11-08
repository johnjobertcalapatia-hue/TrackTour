<?php

namespace Tests\Feature;

use Tests\TestCase;

class BusinessOwnerManualRiderAssignmentDisabledTest extends TestCase
{
    public function test_business_owner_manual_rider_assignment_endpoint_is_removed(): void
    {
        $this->postJson('/api/business-owner/orders/1/assign-rider', ['rider_id' => 1])
            ->assertNotFound();
    }
}
