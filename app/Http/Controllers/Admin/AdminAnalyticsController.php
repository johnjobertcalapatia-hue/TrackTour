<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\PlatformExpense;
use App\Services\AdminAnalyticsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Bansud Tourism Office business-intelligence dashboard and operating expenses. */
class AdminAnalyticsController extends Controller
{
    public function __construct(private AdminAnalyticsService $analytics) {}

    public function index(Request $request): JsonResponse
    {
        $v = $request->validate([
            'period' => ['nullable', Rule::in(AdminAnalyticsService::PERIODS)],
            'from' => ['nullable', 'date_format:Y-m-d', 'required_if:period,custom'],
            'to' => ['nullable', 'date_format:Y-m-d', 'required_if:period,custom', 'after_or_equal:from'],
            'municipality_id' => ['nullable', 'integer', 'exists:municipalities,id'],
        ]);
        if (($v['period'] ?? null) === 'custom' && now()->parse($v['from'])->diffInDays(now()->parse($v['to'])) > 366) {
            return $this->errorResponse('Choose a custom range of one year or less.', 422);
        }

        return $this->successResponse($this->analytics->build(
            $v['period'] ?? 'this_month', $v['from'] ?? null, $v['to'] ?? null, isset($v['municipality_id']) ? (int) $v['municipality_id'] : null
        ));
    }

    public function expenses(Request $request): JsonResponse
    {
        $rows = PlatformExpense::with('recorder:id,name', 'municipality:id,name')
            ->latest('expense_date')->latest('id')->paginate(min(100, max(5, $request->integer('per_page', 20))));

        return $this->successResponse($rows->items(), 'Expenses retrieved.', 200, [
            'total' => $rows->total(), 'current_page' => $rows->currentPage(), 'last_page' => $rows->lastPage(),
            'categories' => PlatformExpense::CATEGORIES,
        ]);
    }

    public function storeExpense(Request $request): JsonResponse
    {
        $v = $request->validate([
            'category' => ['required', Rule::in(PlatformExpense::CATEGORIES)],
            'description' => ['required', 'string', 'max:255'],
            'amount' => ['required', 'numeric', 'min:0.01', 'max:99999999.99'],
            'expense_date' => ['required', 'date_format:Y-m-d', 'before_or_equal:today'],
            'municipality_id' => ['nullable', 'integer', 'exists:municipalities,id'],
        ]);

        $expense = PlatformExpense::create($v + ['recorded_by' => $request->user()->id]);
        ActivityLog::record('platform_expense.recorded', sprintf('Recorded operating expense: %s ₱%s (%s).', $expense->description, number_format((float) $expense->amount, 2), $expense->category), $expense);

        return $this->successResponse($expense->fresh(['recorder:id,name']), 'Expense recorded.', 201);
    }

    public function destroyExpense(PlatformExpense $expense): JsonResponse
    {
        ActivityLog::record('platform_expense.deleted', sprintf('Deleted operating expense: %s ₱%s.', $expense->description, number_format((float) $expense->amount, 2)), $expense);
        $expense->delete();

        return $this->successResponse(null, 'Expense deleted.');
    }
}
