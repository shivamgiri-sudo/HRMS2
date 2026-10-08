/** Starts a post-commit side effect without making the request wait for it. Failures are logged,
 *  never thrown — the GRN transition it follows has already committed. */
export function runInBackground(label: string, task: () => Promise<unknown>): void {
  const onError = (error: unknown) =>
    console.error(`[grn-background] ${label}:`, error instanceof Error ? error.message : error);
  try {
    void task().catch(onError);
  } catch (error) {
    onError(error);
  }
}
