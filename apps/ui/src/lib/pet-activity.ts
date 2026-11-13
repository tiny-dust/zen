import type { PetActivity } from "@zen/shared";
import type { SessionRuntimeStatus } from "@/stores/session-status";

/** Only resolved sessions can appear as finished results; live runs may precede workspace refresh. */
export function buildPetActivity(
  statuses: Record<string, SessionRuntimeStatus>,
  titles: ReadonlyMap<string, string>,
  hasUnseenResult: (id: string) => boolean,
): PetActivity {
  const entries = Object.entries(statuses).flatMap(([id, value]) => {
    const status: PetActivity["sessions"][number]["status"] | null =
      value === "running" || value === "needs_action" ? value
      : (value === "error" || value === "done") && titles.has(id) && hasUnseenResult(id) ? value
      : null;
    if (!status) return [];
    const name = (titles.get(id) ?? "")
      .replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, " ")
      .trim().slice(0, 80).trim() || "会话";
    return [{ id, name, status }];
  });
  const status = entries.some((session) => session.status === "needs_action") ? "waiting"
    : entries.some((session) => session.status === "error") ? "error"
    : entries.some((session) => session.status === "done") ? "done"
    : entries.some((session) => session.status === "running") ? "working"
    : "idle";
  const priority: Record<PetActivity["sessions"][number]["status"], number> = {
    needs_action: 0, error: 1, done: 2, running: 3,
  };
  const sessions = entries.sort((a, b) => priority[a.status] - priority[b.status]).slice(0, 20);
  return { status, sessions };
}
