// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { readFileSync } from "node:fs";
// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const eventDetailViewPath = fileURLToPath(new URL("../../views/EventDetailView.tsx", import.meta.url));

describe("event detail finance regression", () => {
  it("keeps the event-finance expense editing flow wired on event detail", () => {
    const source = readFileSync(eventDetailViewPath, "utf8");

    expect(source).toContain("api.getFinanceEventDetail(event.id)");
    expect(source).toContain("<EventExpensesSheet");
    expect(source).toContain("onEditExpense={openEditExpenseModal}");
    expect(source).toContain("initialTransaction={editingExpense ?? undefined}");
  });
});
