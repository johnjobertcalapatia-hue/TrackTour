<?php

namespace App\Http\Controllers\BusinessOwner;

use App\Http\Controllers\Controller;
use App\Models\Expense;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BusinessOwnerExpenseController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');

        $query = Expense::whereIn('business_id', $businessIds)
            ->with('business')
            ->when($request->get('business_id'), fn($q, $id) => $q->where('business_id', $id))
            ->when($request->get('category'), fn($q, $c) => $q->where('category', $c))
            ->when($request->get('from'), fn($q, $d) => $q->whereDate('expense_date', '>=', $d))
            ->when($request->get('to'), fn($q, $d) => $q->whereDate('expense_date', '<=', $d))
            ->latest();

        return $this->successResponse($query->paginate(20));
    }

    public function store(Request $request): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');

        $validated = $request->validate([
            'business_id' => ['required', 'integer', 'in:' . $businessIds->join(',')],
            'vendor_name' => ['required', 'string', 'max:255'],
            'category' => ['required', 'string', 'in:supplies,utilities,rent,services,ingredients,transport,marketing,salary,other'],
            'amount' => ['required', 'numeric', 'min:0'],
            'expense_date' => ['required', 'date'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        $expense = Expense::create($validated);

        return $this->createdResponse($expense->load('business'), 'Expense recorded successfully.');
    }

    public function show(Request $request, Expense $expense): JsonResponse
    {
        if ($expense->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        return $this->successResponse($expense->load('business'));
    }

    public function update(Request $request, Expense $expense): JsonResponse
    {
        if ($expense->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $businessIds = $request->user()->businesses()->pluck('id');

        $validated = $request->validate([
            'vendor_name' => ['sometimes', 'string', 'max:255'],
            'category' => ['sometimes', 'string', 'in:supplies,utilities,rent,services,ingredients,transport,marketing,salary,other'],
            'amount' => ['sometimes', 'numeric', 'min:0'],
            'expense_date' => ['sometimes', 'date'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        $expense->update($validated);

        return $this->successResponse($expense->load('business'), 'Expense updated successfully.');
    }

    public function destroy(Request $request, Expense $expense): JsonResponse
    {
        if ($expense->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $expense->delete();

        return $this->noContentResponse('Expense archived successfully.');
    }

    public function summary(Request $request): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');

        $period = $request->get('period', 'monthly');
        $dates = match ($period) {
            'weekly' => ['start' => now()->startOfWeek(), 'end' => now()->endOfWeek()],
            'yearly' => ['start' => now()->startOfYear(), 'end' => now()->endOfYear()],
            default => ['start' => now()->startOfMonth(), 'end' => now()->endOfMonth()],
        };

        $totalExpenses = Expense::whereIn('business_id', $businessIds)
            ->whereBetween('expense_date', [$dates['start'], $dates['end']])
            ->sum('amount');

        $byCategory = Expense::whereIn('business_id', $businessIds)
            ->whereBetween('expense_date', [$dates['start'], $dates['end']])
            ->selectRaw('category, SUM(amount) as total')
            ->groupBy('category')
            ->pluck('total', 'category');

        return $this->successResponse([
            'total_expenses' => (float) $totalExpenses,
            'by_category' => $byCategory,
            'period' => $period,
        ]);
    }
}
