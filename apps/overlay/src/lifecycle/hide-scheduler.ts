/**
 * Session-scoped hide-timer policy (gotcha #33). At most one pending hide
 * exists; scheduling a new one (or cancelling) guarantees a stale prior-
 * session timer can never fire against a fresh session. DOM-free + testable.
 */
export class HideScheduler {
  private handle: ReturnType<typeof setTimeout> | undefined;

  scheduleHide(ms: number, onHide: () => void): void {
    this.cancelPending();
    this.handle = setTimeout(() => {
      this.handle = undefined;
      onHide();
    }, ms);
  }

  cancelPending(): void {
    if (this.handle !== undefined) {
      clearTimeout(this.handle);
      this.handle = undefined;
    }
  }
}
