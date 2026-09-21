<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Sales Report</title>
<style>body{font-family:sans-serif;font-size:12px;}table{width:100%;border-collapse:collapse;}th,td{padding:8px;text-align:left;border:1px solid #ddd;}th{background:#f5f5f5;}</style>
</head>
<body>
<h2>Sales Report - {{ ucfirst($period) }}</h2>
<p>Generated: {{ now()->format('Y-m-d H:i') }} | User: {{ $user->name }}</p>
<table>
<thead><tr><th>Date</th><th>Orders</th><th>Revenue</th></tr></thead>
<tbody>
@foreach($data as $row)
<tr><td>{{ $row->date }}</td><td>{{ $row->total_orders }}</td><td>{{ number_format((float)$row->total_revenue, 2) }}</td></tr>
@endforeach
</tbody>
</table>
<h3>Total Revenue: {{ number_format((float)$summary['revenue'], 2) }}</h3>
<h3>Total Orders: {{ $summary['orders'] }}</h3>
</body>
</html>
