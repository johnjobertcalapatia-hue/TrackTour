<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Bookings Report</title>
<style>body{font-family:sans-serif;font-size:12px;}table{width:100%;border-collapse:collapse;}th,td{padding:8px;text-align:left;border:1px solid #ddd;}th{background:#f5f5f5;}</style>
</head>
<body>
<h2>Bookings Report</h2>
<p>Generated: {{ now()->format('Y-m-d H:i') }} | User: {{ $user->name }}</p>
<table>
<thead><tr><th>Status</th><th>Count</th><th>Revenue</th></tr></thead>
<tbody>
@foreach($data as $row)
<tr><td>{{ $row->status }}</td><td>{{ $row->count }}</td><td>{{ number_format((float)$row->revenue, 2) }}</td></tr>
@endforeach
</tbody>
</table>
</body>
</html>
