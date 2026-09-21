<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>{{ ucfirst($type) }} Report</title>
<style>table{border-collapse:collapse;}th,td{padding:6px;border:1px solid #ccc;}</style>
</head>
<body>
<table>
<thead><tr>@if($type==='sales')<th>Date</th><th>Orders</th><th>Revenue</th>@else<th>Status</th><th>Count</th><th>Revenue</th>@endif</tr></thead>
<tbody>
@foreach($data as $row)
<tr>@if($type==='sales')<td>{{ $row->date }}</td><td>{{ $row->total_orders }}</td><td>{{ $row->total_revenue }}</td>@else<td>{{ $row->status }}</td><td>{{ $row->count }}</td><td>{{ $row->revenue }}</td>@endif</tr>
@endforeach
</tbody>
</table>
</body>
</html>
