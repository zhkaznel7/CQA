// Shared by Prisma CLI, application and the Docker entrypoint.
export function databaseUrl(environment = process.env) {
  if (environment.DATABASE_URL) return environment.DATABASE_URL;
  if (!environment.PGHOST || !environment.POSTGRES_USER || !environment.POSTGRES_PASSWORD || !environment.POSTGRES_DB) {
    return undefined;
  }
  const url = new URL(`postgresql://${environment.PGHOST}:${environment.PGPORT ?? '5432'}/`);
  url.username = encodeURIComponent(environment.POSTGRES_USER);
  url.password = encodeURIComponent(environment.POSTGRES_PASSWORD);
  url.pathname = `/${encodeURIComponent(environment.POSTGRES_DB)}`;
  return url.toString();
}
