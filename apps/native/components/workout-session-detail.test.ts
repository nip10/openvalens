import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, mock, test } from "bun:test";
import * as React from "react";

const child = process.env.NATIVE_DETAIL_TEST === "1";
test.skipIf(child)(
  "isolates mounted workout detail interactions",
  async () => {
    const result = await promisify(execFile)(process.execPath, ["test", import.meta.path], {
      cwd: `${import.meta.dir}/..`,
      env: { ...process.env, NATIVE_DETAIL_TEST: "1" },
      timeout: 25_000,
      maxBuffer: 10_000_000,
    });
    const output = `${result.stdout}${result.stderr}`;
    console.log(output);
    expect(output).toContain("1 pass");
    expect(output).toContain("1 skip");
    expect(output).toContain("0 fail");
  },
  30_000,
);

if (child) {
  const opened: any[] = [];
  const deleted: any[] = [];
  // Save-as-routine needs the API client and offline scope; it is covered by the routines suite.
  mock.module("@/components/workout-routines", () => ({ SaveWorkoutAsRoutine: () => null }));
  mock.module("@/lib/workouts/sync", () => ({
    useWorkoutSession: () => ({
      openWorkout: (workout: any) => {
        opened.push(workout);
        return true;
      },
      deleteWorkout: (workout: any) => {
        deleted.push(workout);
        return true;
      },
    }),
  }));
  test("mounted detail invokes edit and confirmed delete callbacks and keeps legacy session read-only", async () => {
    const { setupMountedHarness } = await import("./workout-test-harness");
    const h = await setupMountedHarness();
    const workout: any = {
      id: 4,
      date: "2026-10-25",
      duration: 45,
      ownership: "mine",
      canEdit: true,
      notes: "After work",
      prs: [],
      exercises: [
        {
          name: "Squat",
          notes: null,
          sets: [{ id: 5, weightKg: 80, reps: 8, rpe: 7, notes: null }],
        },
      ],
    };
    let closed = 0;
    try {
      const { WorkoutSessionDetail } = await import("./workout-session-detail");
      await h.render(
        React.createElement(WorkoutSessionDetail, {
          units: "metric",
          workout,
          onClose: () => {
            closed++;
          },
        }),
      );
      expect(h.container.textContent).toContain("Squat");
      expect(h.container.textContent).toContain("After work");
      await h.click("Edit workout");
      expect(opened).toEqual([workout]);
      expect(closed).toBe(1);
      await h.click("Delete");
      expect(h.alerts.at(-1)?.title).toBe("Delete workout?");
      expect(deleted).toHaveLength(0);
      await React.act(async () =>
        h.alerts
          .at(-1)
          ?.buttons?.find((b) => b.text === "Delete")
          ?.onPress?.(),
      );
      expect(deleted).toEqual([workout]);
      expect(closed).toBe(2);
      await h.render(
        React.createElement(WorkoutSessionDetail, {
          units: "metric",
          workout: { ...workout, ownership: "legacy", canEdit: false },
          onClose: () => {
            closed++;
          },
        }),
      );
      expect(h.container.textContent).toContain("Legacy session · read only");
      expect(h.container.textContent).not.toContain("Edit workout");
      expect(
        Array.from(h.container.querySelectorAll("button")).some((b) => b.textContent === "Delete"),
      ).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
}
