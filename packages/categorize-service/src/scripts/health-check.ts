const port = Number(process.env.PORT ?? 8080);

function getHealthStatus(response: unknown): string | undefined {
  if (
    typeof response === 'object' &&
    response !== null &&
    'status' in response &&
    typeof response.status === 'string'
  ) {
    return response.status;
  }

  return undefined;
}

fetch(`http://localhost:${port}/health`)
  .then(response => response.json())
  .then(response => {
    const status = getHealthStatus(response);

    if (status !== 'UP') {
      throw new Error(
        'Health check failed: Server responded to health check with status ' +
          status,
      );
    }
  })
  .catch(err => {
    console.log('Health check failed:', err);
    process.exit(1);
  });
