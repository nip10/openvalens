import type { OfflineWriteTicket } from "@/lib/offline/sync";

export type AddFoodSaveIntent = {
  generation: number;
  ticket: OfflineWriteTicket | null;
  foodFingerprint: string;
  createMutationId: string;
  diaryMutationId: string;
};

/** Small synchronous gate shared by the Add Food form and its async completion. */
export class AddFoodSaveController {
  private generation = 0;
  private pending = false;
  private active: AddFoodSaveIntent | null = null;
  private retry: Pick<
    AddFoodSaveIntent,
    "foodFingerprint" | "createMutationId" | "diaryMutationId"
  > | null = null;

  begin(
    ticket: OfflineWriteTicket | null,
    fingerprint: string,
    newId: () => string,
  ): AddFoodSaveIntent | null {
    if (this.pending) return null;
    this.pending = true;
    if (!this.retry || this.retry.foodFingerprint !== fingerprint) {
      this.retry = {
        foodFingerprint: fingerprint,
        createMutationId: newId(),
        diaryMutationId: newId(),
      };
    }
    const intent = { generation: this.generation, ticket, ...this.retry };
    this.active = intent;
    return intent;
  }

  isCurrent(intent: AddFoodSaveIntent): boolean {
    return this.pending && this.active === intent && intent.generation === this.generation;
  }

  finish(intent: AddFoodSaveIntent): boolean {
    if (!this.isCurrent(intent)) return false;
    this.pending = false;
    this.active = null;
    this.retry = null;
    return true;
  }

  release(intent: AddFoodSaveIntent): boolean {
    if (!this.isCurrent(intent)) return false;
    this.pending = false;
    this.active = null;
    return true;
  }

  invalidate(): void {
    this.generation += 1;
    this.pending = false;
    this.active = null;
    this.retry = null;
  }
}
