/**
 * A utility function for safely executing Supabase queries with error handling
 *
 * @param queryFn The database query function to execute
 * @param fallback A fallback value to return in case of an error
 * @param errorMessage Optional custom error message for logging
 * @returns The query result or fallback value
 */
export async function safeQuery<T>(
  queryFn: () => Promise<T>,
  fallback: T,
  errorMessage: string = "Database query error"
): Promise<T> {
  try {
    return await queryFn()
  } catch (error: any) {
    console.error(`${errorMessage}:`, error)
    return fallback
  }
}
