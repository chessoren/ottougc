import { PageHeader } from "@/components/dashboard/Shell";
import { Badge, Card, EmptyState } from "@/components/ui/primitives";
import { getFormatPerformance, getPrimaryBrand } from "@/server/dashboard/queries";
import { ALL_SCENARIOS, getScenario } from "@/server/knowledge/scenarios";

export const dynamic = "force-dynamic";

/**
 * Format performance.
 *
 * The point of this page is the distinction between "this format does not work"
 * and "this format has barely been tried". Sorting by score alone hides that, so
 * the trial count sits next to every row and untested formats are listed rather
 * than omitted.
 */
export default async function FormatsPage() {
  const brand = await getPrimaryBrand();
  if (!brand) return null;

  const rows = await getFormatPerformance(brand.id);
  const tried = new Set(rows.map((r) => r.formatId));
  const untried = ALL_SCENARIOS.filter((s) => !tried.has(s.id));

  return (
    <>
      <PageHeader
        title="Scenarios"
        description="How each scenario is doing, and what that implies. A scenario that has barely been tried keeps its chance — one in five videos is a deliberate gamble."
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No data yet"
          description="No videos made yet. Per-scenario results will show up here."
        />
      ) : (
        <Card className="mb-6 overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-surface-2">
                  <Th>Scenario</Th>
                  <Th right>Made</Th>
                  <Th right>Posted</Th>
                  <Th right>Views</Th>
                  <Th right>Avg score</Th>
                  <Th right>Outliers</Th>
                  <Th right>Dropped</Th>
                  <Th right>Est. win rate</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const scenario = getScenario(r.formatId);
                  const thin = r.total < 4;
                  return (
                    <tr key={r.formatId} className="border-b border-line last:border-0">
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base text-ink">{scenario?.name ?? r.formatId}</span>
                          {r.outliers > 0 ? <Badge tone="win">outlier</Badge> : null}
                          {thin ? <Badge tone="warn">thin sample</Badge> : null}
                        </div>
                        <span className="tnum text-2xs text-ink-faint">{r.formatId}</span>
                      </td>
                      <Td right>{r.total}</Td>
                      <Td right>{r.published}</Td>
                      <Td right>{r.views.toLocaleString("en-US")}</Td>
                      <Td right>{Number(r.avgScore).toFixed(3)}</Td>
                      <Td right tone={r.outliers > 0 ? "win" : undefined}>
                        {r.outliers}
                      </Td>
                      <Td right tone={r.kills > 0 ? "kill" : undefined}>
                        {r.kills}
                      </Td>
                      <Td right>
                        {r.estimatedWinRate !== null
                          ? `${(r.estimatedWinRate * 100).toFixed(0)} %`
                          : "—"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {untried.length > 0 ? (
        <Card className="p-6">
          <h2 className="text-xl">Never tried</h2>
          <p className="mt-1.5 max-w-[74ch] text-base leading-relaxed text-ink-muted">
            A share of every day goes to these on purpose. A set of channels that stops experimenting stops finding the outliers that produce all the results.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {untried.map((f) => (
              <span
                key={f.id}
                className="rounded-pill border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink-muted"
              >
                {f.name}
                <span className="tnum ml-2 text-2xs text-ink-faint">
                  ${f.estimatedCostUsd.toFixed(2)}
                </span>
              </span>
            ))}
          </div>
        </Card>
      ) : null}
    </>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-5 py-3 text-sm font-semibold text-ink-subtle ${right ? "text-right" : ""}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right,
  tone,
}: {
  children: React.ReactNode;
  right?: boolean;
  tone?: "win" | "kill";
}) {
  return (
    <td
      className={`tnum px-5 py-3.5 text-base ${right ? "text-right" : ""} ${
        tone === "win" ? "text-win font-semibold" : tone === "kill" ? "text-kill font-semibold" : "text-ink"
      }`}
    >
      {children}
    </td>
  );
}
