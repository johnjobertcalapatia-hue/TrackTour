<?php

namespace Tests\Unit;

use App\Models\Business;
use Carbon\Carbon;
use Tests\TestCase;

/**
 * Guards the "restaurant is open 24/7" fixture used by the order/delivery
 * suites against the exclusive-close boundary in Business::isInsidePeriods():
 * a single ['00:00', '23:59'] period reads as CLOSED during the minute 23:59
 * Manila time, which made those suites fail whenever they crossed that minute.
 *
 * The fixtures therefore carry a second overnight period that covers the
 * boundary. Production logic (isInsidePeriods) is intentionally untouched —
 * close stays exclusive, which is the real business rule.
 */
class BusinessHoursBoundaryTest extends TestCase
{
    private function businessWithHours(array $periods): Business
    {
        $days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

        $business = new Business();
        $business->forceFill([
            'force_closed' => false,
            'business_hours' => array_fill_keys($days, $periods),
        ]);

        return $business;
    }

    private function atManila(int $hour, int $minute): void
    {
        // Fixed instant whose Manila wall-clock rendering is exactly H:M.
        Carbon::setTestNow(Carbon::parse('2026-01-05', 'Asia/Manila')->setTime($hour, $minute, 30));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_single_2359_period_is_the_boundary_that_flaked(): void
    {
        $single = $this->businessWithHours([['open' => '00:00', 'close' => '23:59']]);

        $this->atManila(23, 58);
        $this->assertTrue($single->isOpenNow(), 'open at 23:58');

        $this->atManila(23, 59);
        $this->assertFalse($single->isOpenNow(), 'close is exclusive: the old fixture read as closed at 23:59');
    }

    public function test_fixture_with_overnight_boundary_period_is_open_every_minute(): void
    {
        $fixture = $this->businessWithHours([
            ['open' => '00:00', 'close' => '23:59'],
            ['open' => '23:59', 'close' => '00:00'],
        ]);

        foreach ([[0, 0], [8, 30], [12, 0], [23, 58], [23, 59]] as [$hour, $minute]) {
            $this->atManila($hour, $minute);
            $this->assertTrue(
                $fixture->isOpenNow(),
                sprintf('fixture must be open at %02d:%02d Manila', $hour, $minute)
            );
        }
    }

    public function test_open_at_the_boundary_means_orders_are_accepted(): void
    {
        $days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

        $fixture = new Business();
        $fixture->forceFill([
            'status' => 'approved',
            'force_closed' => false,
            'business_hours' => array_fill_keys($days, [
                ['open' => '00:00', 'close' => '23:59'],
                ['open' => '23:59', 'close' => '00:00'],
            ]),
        ]);

        // This is the assertion GroupOrderService::createGroup() depends on.
        $this->atManila(23, 59);

        $this->assertTrue($fixture->isAcceptingOrders());
    }
}
