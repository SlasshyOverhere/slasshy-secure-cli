export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function successPage(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Slasshy - Authorization Complete</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: rgba(255,255,255,0.1);
      border-radius: 16px;
      backdrop-filter: blur(10px);
    }
    .success-icon {
      font-size: 64px;
      margin-bottom: 20px;
    }
    h1 { margin: 0 0 10px; }
    p { opacity: 0.8; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon">✓</div>
    <h1>Authorization Complete!</h1>
    <p>You can close this window and return to Slasshy CLI.</p>
  </div>
</body>
</html>`;
}

export function errorPage(message: string): string {
  const safeMessage = escapeHtml(message);
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Slasshy - Authorization Error</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: rgba(255,255,255,0.1);
      border-radius: 16px;
      backdrop-filter: blur(10px);
    }
    .error-icon {
      font-size: 64px;
      margin-bottom: 20px;
      color: #ff6b6b;
    }
    h1 { margin: 0 0 10px; color: #ff6b6b; }
    p { opacity: 0.8; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-icon">✕</div>
    <h1>Authorization Failed</h1>
    <p>${safeMessage}</p>
  </div>
</body>
</html>`;
}
