<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/assets/logo/tracktour.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TrackTour — Bansud Tourism</title>
    <link rel="preconnect" href="https://fonts.bunny.net" />
    <link href="https://fonts.bunny.net/css?family=figtree:400,500,600,700|poppins:600,700,800&display=swap" rel="stylesheet" />
    <style>
      html, body { background-color: #F8FAF7; margin: 0; }
      #root:empty {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
      }
      #root:empty::after {
        content: '';
        width: 32px;
        height: 32px;
        border: 3px solid rgba(16, 185, 129, 0.2);
        border-top-color: #10b981;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
    @viteReactRefresh
    @vite(['frontend/src/main.tsx'])
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
