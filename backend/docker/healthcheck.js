try {
  const response = await fetch('http://127.0.0.1:3000/api/health', {
    signal: AbortSignal.timeout(3000),
  });
  const data = await response.json();
  process.exitCode = response.ok && data.status === 'ok' ? 0 : 1;
} catch {
  process.exitCode = 1;
}
