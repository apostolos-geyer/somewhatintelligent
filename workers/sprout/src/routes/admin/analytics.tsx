import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Download,
  FileText,
  Loader2,
  type LucideIcon,
  Package,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { Button } from "@greenroom/ui/components/button";
import { Badge } from "@greenroom/ui/components/badge";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@greenroom/ui/components/tabs";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import { BarChart } from "@/components/admin/charts/BarChart";
import { TopNBars } from "@/components/admin/charts/TopNBars";
import {
  type AiQuestionStatsRow,
  type BudtenderMatrixRow,
  type CsvView,
  type DeckStatsRow,
  exportCsv,
  getAiQuestionStats,
  getBudtenderMatrix,
  getDeckStats,
  getProductStats,
  getQuizStats,
  type ProductStatsRow,
  type QuizStatsRow,
} from "@/lib/analytics.functions";

/**
 * Brand-Admin analytics dashboards (P6.A) + per-view CSV export (P6.B). Nests
 * under the pathless `admin.tsx` guard — SELF-CONTAINED. Every read is gated
 * server-side on `assertBrandAdmin` (a plain budtender 403s); brand_id is the
 * envelope's activeOrgId, NEVER sent. Five tabs, each backed by its own gated read
 * + a "Download CSV" button that calls `exportCsv` (a server fn that returns a raw
 * text/csv Response, downloaded client-side as a Blob). The charts are the
 * token-driven SVG primitives in `components/admin/charts` — NO chart library.
 */
export const Route = createFileRoute("/admin/analytics")({
  component: AdminAnalyticsPage,
});

/** Trigger a brand-scoped CSV download for one view. The server fn returns a raw
 * Response (text/csv; attachment) — we read it as a Blob and click a temp anchor
 * so the browser saves the file with its Content-Disposition filename. */
async function downloadCsv(view: CsvView): Promise<void> {
  const res = await exportCsv({ data: { view } });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sprout-${view}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function DownloadCsvButton({ view }: { view: CsvView }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void downloadCsv(view).finally(() => setBusy(false));
      }}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Download className="size-4" aria-hidden />
      )}
      Download CSV
    </Button>
  );
}

/** Until guestlist names resolve, show a short stable handle from the user id. */
function shortenId(userId: string): string {
  return userId.length <= 10 ? userId : `${userId.slice(0, 10)}…`;
}

/** Generic async-data hook used by each tab — loads once, exposes data/error. */
function useAnalytics<T>(load: () => Promise<T>): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        setData(await load());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load analytics.");
      }
    })();
    // load is a stable module-level fn per tab; intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { data, error };
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-12 w-full rounded-sm" />
      ))}
    </div>
  );
}

function TabHeader({
  title,
  description,
  view,
}: {
  title: string;
  description: string;
  view: CsvView;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h2 className="font-display text-xl font-bold tracking-tight">{title}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      </div>
      <DownloadCsvButton view={view} />
    </div>
  );
}

function AdminAnalyticsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
          <BarChart3 className="size-6 text-primary" aria-hidden />
          Analytics
        </h1>
        <p className="text-sm text-muted-foreground">
          Engagement across your portal — per budtender, deck, product, and quiz, plus what's being
          asked of the AI. Export any view to CSV.
        </p>
      </header>

      <Tabs defaultValue="budtenders">
        <TabsList className="mb-2 w-full max-w-full overflow-x-auto sm:w-fit sm:overflow-visible">
          <NavTab value="budtenders" icon={Users} label="Budtenders" />
          <NavTab value="decks" icon={FileText} label="Decks" />
          <NavTab value="products" icon={Package} label="Products" />
          <NavTab value="quizzes" icon={Trophy} label="Quizzes" />
          <NavTab value="ai" icon={Sparkles} label="AI questions" />
        </TabsList>

        <TabsContent value="budtenders">
          <BudtendersTab />
        </TabsContent>
        <TabsContent value="decks">
          <DecksTab />
        </TabsContent>
        <TabsContent value="products">
          <ProductsTab />
        </TabsContent>
        <TabsContent value="quizzes">
          <QuizzesTab />
        </TabsContent>
        <TabsContent value="ai">
          <AiTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NavTab({ value, icon: Icon, label }: { value: string; icon: LucideIcon; label: string }) {
  return (
    <TabsTrigger value={value}>
      <Icon className="size-4" aria-hidden />
      {label}
    </TabsTrigger>
  );
}

// ─── shared table chrome (identity admin-table shape) ───────────────────────

function TableShell({
  head,
  children,
  minWidth = 640,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left">{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {children}
    </th>
  );
}

function EmptyRow({ span, label }: { span: number; label: string }) {
  return (
    <tr>
      <td colSpan={span} className="px-3 py-10 text-center text-sm text-muted-foreground">
        {label}
      </td>
    </tr>
  );
}

// ─── budtenders tab — the per-budtender matrix (TABLE) ──────────────────────

function BudtendersTab() {
  const { data, error } = useAnalytics(() => getBudtenderMatrix({ data: {} }));
  const rows = data?.rows ?? null;

  return (
    <div className="space-y-4">
      <TabHeader
        title="Per-budtender matrix"
        description="Every budtender's engagement across decks, quizzes, products, reviews, feed, sessions, downloads, requests, AI, and chat — ranked by total activity."
        view="budtenders"
      />
      {error && <ErrorNote message={error} />}
      {rows === null && !error && <LoadingRows />}
      {rows !== null && (
        <TableShell
          minWidth={900}
          head={
            <>
              <Th className="text-left">#</Th>
              <Th className="text-left">Budtender</Th>
              <Th className="text-right">Decks</Th>
              <Th className="text-right">Quizzes</Th>
              <Th className="text-right">Products</Th>
              <Th className="text-right">Reviews</Th>
              <Th className="text-right">Feed</Th>
              <Th className="text-right">Sessions</Th>
              <Th className="text-right">Downloads</Th>
              <Th className="text-right">Requests</Th>
              <Th className="text-right">AI</Th>
              <Th className="text-right">Chat</Th>
              <Th className="text-right">Certs</Th>
              <Th className="text-right">Total</Th>
            </>
          }
        >
          {rows.length === 0 ? (
            <EmptyRow span={14} label="No engagement recorded yet." />
          ) : (
            rows.map((r) => <MatrixRow key={r.actorId} row={r} />)
          )}
        </TableShell>
      )}
    </div>
  );
}

function Num({ children }: { children: number }) {
  return <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{children}</td>;
}

function MatrixRow({ row }: { row: BudtenderMatrixRow }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 tabular-nums text-muted-foreground">
        {row.rank <= 3 ? (
          <Badge variant={row.rank === 1 ? "sprout" : "sprout-glass"}>#{row.rank}</Badge>
        ) : (
          `#${row.rank}`
        )}
      </td>
      <td className="px-3 py-2 text-xs" title={row.actorId}>
        {row.name ?? <span className="font-mono">{shortenId(row.actorId)}</span>}
      </td>
      <Num>{row.deckOpens}</Num>
      <Num>{row.quizSubmits}</Num>
      <Num>{row.productViews}</Num>
      <Num>{row.reviews}</Num>
      <Num>{row.feedPosts}</Num>
      <Num>{row.sessionJoins}</Num>
      <Num>{row.downloads}</Num>
      <Num>{row.physicalRequests}</Num>
      <Num>{row.aiQuestions}</Num>
      <Num>{row.chatMessages}</Num>
      <Num>{row.certs}</Num>
      <td className="px-3 py-2 text-right font-display font-bold tabular-nums">{row.total}</td>
    </tr>
  );
}

// ─── decks tab — table + opens-by-deck bar chart ────────────────────────────

function formatSeconds(secs: number): string {
  if (secs <= 0) return "—";
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function DecksTab() {
  const { data, error } = useAnalytics(() => getDeckStats({ data: {} }));
  const rows = data?.rows ?? null;
  const chartData = (rows ?? [])
    .filter((r) => r.opens > 0)
    .slice(0, 8)
    .map((r, i) => ({ label: r.title, value: r.opens, slot: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5 }));

  return (
    <div className="space-y-4">
      <TabHeader
        title="Deck engagement"
        description="Opens, flip volume, average time on a deck, the deepest page anyone reached, and downloads — per deck."
        view="decks"
      />
      {error && <ErrorNote message={error} />}
      {rows === null && !error && <LoadingRows />}
      {rows !== null && (
        <>
          {chartData.length > 0 && (
            <div className={cn("p-4", surfaceMaterials.brutal)}>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Opens by deck
              </p>
              <BarChart data={chartData} ariaLabel="Deck opens by deck" unit="opens" />
            </div>
          )}
          <TableShell
            minWidth={680}
            head={
              <>
                <Th className="text-left">Deck</Th>
                <Th className="text-right">Opens</Th>
                <Th className="text-right">Flips</Th>
                <Th className="text-right">Avg time</Th>
                <Th className="text-right">Deepest page</Th>
                <Th className="text-right">Downloads</Th>
              </>
            }
          >
            {rows.length === 0 ? (
              <EmptyRow span={6} label="No decks yet." />
            ) : (
              rows.map((r) => <DeckRow key={r.deckId} row={r} />)
            )}
          </TableShell>
        </>
      )}
    </div>
  );
}

function DeckRow({ row }: { row: DeckStatsRow }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 font-medium" title={row.title}>
        {row.title}
      </td>
      <Num>{row.opens}</Num>
      <Num>{row.flips}</Num>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {formatSeconds(row.avgFlipSeconds)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {row.lastPageReached > 0
          ? `${row.lastPageReached}${row.pageCount > 0 ? ` / ${row.pageCount}` : ""}`
          : "—"}
      </td>
      <Num>{row.downloads}</Num>
    </tr>
  );
}

// ─── products tab — table + views-by-product bar chart ──────────────────────

function ProductsTab() {
  const { data, error } = useAnalytics(() => getProductStats({ data: {} }));
  const rows = data?.rows ?? null;
  const chartData = (rows ?? [])
    .filter((r) => r.views > 0)
    .slice(0, 8)
    .map((r, i) => ({ label: r.name, value: r.views, slot: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5 }));

  return (
    <div className="space-y-4">
      <TabHeader
        title="Product engagement"
        description="Views over the period plus each product's review count and average star rating."
        view="products"
      />
      {error && <ErrorNote message={error} />}
      {rows === null && !error && <LoadingRows />}
      {rows !== null && (
        <>
          {chartData.length > 0 && (
            <div className={cn("p-4", surfaceMaterials.brutal)}>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Views by product
              </p>
              <BarChart data={chartData} ariaLabel="Product views by product" unit="views" />
            </div>
          )}
          <TableShell
            minWidth={560}
            head={
              <>
                <Th className="text-left">Product</Th>
                <Th className="text-left">Category</Th>
                <Th className="text-right">Views</Th>
                <Th className="text-right">Reviews</Th>
                <Th className="text-right">Avg stars</Th>
              </>
            }
          >
            {rows.length === 0 ? (
              <EmptyRow span={5} label="No products yet." />
            ) : (
              rows.map((r) => <ProductRow key={r.productId} row={r} />)
            )}
          </TableShell>
        </>
      )}
    </div>
  );
}

function ProductRow({ row }: { row: ProductStatsRow }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 font-medium" title={row.name}>
        {row.name}
      </td>
      <td className="px-3 py-2 text-muted-foreground">{row.category}</td>
      <Num>{row.views}</Num>
      <Num>{row.reviewCount}</Num>
      <td className="px-3 py-2 text-right tabular-nums">
        {row.reviewCount > 0 ? (
          <span className="inline-flex items-center gap-1 font-medium">
            {row.avgStars.toFixed(1)}
            <span className="text-pistil" aria-hidden>
              ★
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

// ─── quizzes tab — table + most-missed callouts ─────────────────────────────

function QuizzesTab() {
  const { data, error } = useAnalytics(() => getQuizStats({ data: {} }));
  const rows = data?.rows ?? null;
  const missed = (rows ?? [])
    .filter((r) => r.mostMissedPrompt && r.mostMissedWrongCount > 0)
    .sort((a, b) => b.mostMissedWrongCount - a.mostMissedWrongCount)
    .slice(0, 6)
    .map((r) => ({
      label: r.mostMissedPrompt as string,
      value: r.mostMissedWrongCount,
      note: r.title,
      slot: 2 as const, // stigma — these are the "trouble" rows
    }));

  return (
    <div className="space-y-4">
      <TabHeader
        title="Quiz outcomes"
        description="Completion rate (passed ÷ submitted), average grade, and the single most-missed question per quiz."
        view="quizzes"
      />
      {error && <ErrorNote message={error} />}
      {rows === null && !error && <LoadingRows />}
      {rows !== null && (
        <>
          <TableShell
            minWidth={680}
            head={
              <>
                <Th className="text-left">Quiz</Th>
                <Th className="text-right">Attempts</Th>
                <Th className="text-right">Completion</Th>
                <Th className="text-right">Avg grade</Th>
                <Th className="text-left">Most-missed question</Th>
              </>
            }
          >
            {rows.length === 0 ? (
              <EmptyRow span={5} label="No quizzes yet." />
            ) : (
              rows.map((r) => <QuizRow key={r.quizId} row={r} />)
            )}
          </TableShell>

          {missed.length > 0 && (
            <div className={cn("space-y-3 p-4", surfaceMaterials.brutal)}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Most-missed questions
              </p>
              <TopNBars
                data={missed}
                ariaLabel="Most-missed quiz questions by wrong-answer count"
                unit="wrong"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function QuizRow({ row }: { row: QuizStatsRow }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 font-medium" title={row.title}>
        {row.title}
      </td>
      <Num>{row.attempts}</Num>
      <td className="px-3 py-2 text-right tabular-nums">
        {row.attempts > 0 ? `${row.completionRate}%` : "—"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {row.attempts > 0 ? `${row.avgGradePercent}%` : "—"}
      </td>
      <td className="max-w-xs px-3 py-2 text-sm text-muted-foreground">
        {row.mostMissedPrompt ? (
          <span title={row.mostMissedPrompt}>
            {row.mostMissedPrompt}
            <span className="ml-1.5 text-xs text-stigma">({row.mostMissedWrongCount})</span>
          </span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

// ─── AI tab — top questions (TopNBars) ──────────────────────────────────────

function AiTab() {
  const { data, error } = useAnalytics(() => getAiQuestionStats({ data: {} }));
  const rows = data?.rows ?? null;
  const top = (rows ?? []).map((r: AiQuestionStatsRow) => ({
    label: r.question,
    value: r.count,
    note: r.unanswered ? "No grounding match — add a custom Q&A" : undefined,
    slot: (r.unanswered ? 2 : 1) as 1 | 2,
  }));

  return (
    <div className="space-y-4">
      <TabHeader
        title="Top AI questions"
        description="What budtenders ask the assistant most. Rows flagged 'no grounding match' are gaps — author a custom Q&A to cover them."
        view="ai_questions"
      />
      {error && <ErrorNote message={error} />}
      {rows === null && !error && <LoadingRows />}
      {rows !== null && (
        <div className={cn("p-4", surfaceMaterials.brutal)}>
          <TopNBars
            data={top}
            ariaLabel="Top questions asked of the AI assistant"
            unit="asks"
            emptyLabel="No AI questions logged yet."
          />
        </div>
      )}
    </div>
  );
}
