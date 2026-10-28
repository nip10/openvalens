export type LoggerDismissalMessage = "nothing_saved" | "pending_food_creation_cancelled";

/** Tracks whether leaving a logger can truthfully say that nothing was saved. */
export class FoodLoggerDismissal {
  private createDispatched = false;
  private saved = false;
  private dismissed = false;

  markCreateDispatched(): void {
    this.createDispatched = true;
  }

  markSaved(): void {
    this.saved = true;
  }

  dismiss(): LoggerDismissalMessage | null {
    if (this.saved || this.dismissed) return null;
    this.dismissed = true;
    return this.createDispatched ? "pending_food_creation_cancelled" : "nothing_saved";
  }
}
