import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  AuditComboChart, KpiRow, MatrixTable, NoteBanner, RegionTable, TrailMissChart, TrailTable, TrailTaskChart,
  auditCardSpecs, trailCardSpecs,
  type AuditMatrixRow, type LoadState, type PoaAuditPage, type PoaDrill, type PoaDrillHandler,
  type PoaTrailPage as PoaTrailPayload, type TrailDetailRow,
} from "./PoaPagesTables";

export type { PoaDrill } from "./PoaPagesTables";

/**
 * POA Internal / POA External / POA Trail pages — the "Central Dashboard"
 * reference layout (summary cards, chart(s), deep-dive tables with Grand Total,
 * Top 10 Analyst / Defaulter) on the real onfido_db tables. Endpoints:
 *   GET /api/onfido-process/poa-pages/{internal|external|trail}
 * FAR / FRR / Manual FAR / Manual FRR are never shown here (owner constraint).
 */

export interface PoaPageProps {
  range: { from: string; to: string };
  tlFilter: string;
  amFilter: string;
  onDrill?: PoaDrillHandler;
}

type PageKind = "internal" | "external" | "trail";

const UNASSIGNED_DRILL_VALUE = "(unassigned)";

function usePoaPage<T>(kind: PageKind, { range, tlFilter, amFilter }: PoaPageProps): { data: T | undefined; state: LoadState } {
  const qs =
    `from=${range.from}&to=${range.to}` +
    (tlFilter ? `&tlName=${encodeURIComponent(tlFilter)}` : "") +
    (amFilter ? `&amName=${encodeURIComponent(amFilter)}` : "");
  const query = useQuery({
    queryKey: ["onfido-process", "poa-pages", kind, range.from, range.to, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: T }>(`/api/onfido-process/poa-pages/${kind}?${qs}`),
  });
  const error = query.error instanceof Error ? query.error.message : query.error ? "Request failed" : null;
  return { data: query.data?.data, state: { loading: query.isLoading, error } };
}

const EMPTY_AUDIT_ROWS: AuditMatrixRow[] = [];

/** Row-click handler for a deep-dive table whose particular is a real column value. */
function rowDrill(
  onDrill: PoaDrillHandler | undefined,
  table: PoaDrill["table"],
  filterColumn: string,
  label: string,
): ((row: AuditMatrixRow) => void) | undefined {
  if (!onDrill) return undefined;
  return (row) =>
    onDrill({
      title: `${label}: ${row.particular}`,
      table,
      filterColumn,
      filterValue: row.particular === "Blank" ? UNASSIGNED_DRILL_VALUE : row.particular,
    });
}

interface AuditPageConfig {
  kind: "internal" | "external";
  scopeLabel: string;
  table: PoaDrill["table"];
  /** Column names that exist on `table` and are accepted as drill filters. */
  cols: { tl: string; am: string; analyst: string; client: string | null };
  labels: Parameters<typeof auditCardSpecs>[1];
}

function AuditPage({ config, props }: { config: AuditPageConfig; props: PoaPageProps }) {
  const { data, state } = usePoaPage<PoaAuditPage>(config.kind, props);
  const { onDrill } = props;
  const s = config.scopeLabel;
  const analystDrill = rowDrill(onDrill, config.table, config.cols.analyst, "Analyst");
  const matrix = (title: string, first: string, rows: AuditMatrixRow[] | undefined, onRowClick?: (r: AuditMatrixRow) => void) => (
    <MatrixTable title={title} firstHeader={first} rows={rows ?? EMPTY_AUDIT_ROWS} state={state} onRowClick={onRowClick} />
  );

  return (
    <div className="space-y-4">
      <NoteBanner notes={data?.notes ?? []} />
      <KpiRow cards={auditCardSpecs(data?.cards, config.labels)} state={state} />
      <AuditComboChart title="Date-wise Audits vs Error & Error%" points={data?.chartDaily ?? []} state={state} />
      {config.kind === "internal" && (
        <RegionTable
          title="Day Wise - EU / CA / US Internal Quality"
          sub="Region is derived from the issuing country: USA = US, CAN = CA, every other country (or blank) = EU."
          rows={data?.regionQuality ?? []}
          state={state}
        />
      )}
      {matrix(`Date-wise ${s} Quality Error Deep Dive`, "Date", data?.dailyArr)}
      {matrix(`WC-wise ${s} Quality Error Deep Dive`, "WC", data?.weeklyArr)}
      {matrix(`TL-wise ${s} Quality Error Deep Dive`, "TL Name", data?.tlArr, rowDrill(onDrill, config.table, config.cols.tl, "TL"))}
      {matrix(`AM-wise ${s} Quality Error Deep Dive`, "AM Name", data?.amArr, rowDrill(onDrill, config.table, config.cols.am, "AM"))}
      {matrix(`Agent / Analyst-wise ${s} Quality Error Deep Dive`, "Agent / Analyst", data?.analystArr, analystDrill)}
      {matrix(
        `Client-wise ${s} Quality Error Deep Dive`, "Client", data?.clientArr,
        config.cols.client ? rowDrill(onDrill, config.table, config.cols.client, "Client") : undefined,
      )}
      {matrix(`Document Type-wise ${s} Quality Error Deep Dive`, "Document Type", data?.docArr)}
      {matrix(`Top 10 Analyst - ${s} Quality`, "Analyst", data?.topAnalysts, analystDrill)}
      {matrix(`Top 10 Defaulter Analyst - ${s} Quality`, "Analyst", data?.topDefaulters, analystDrill)}
    </div>
  );
}

const INTERNAL_CONFIG: AuditPageConfig = {
  kind: "internal",
  scopeLabel: "Internal",
  table: "ONFIDO_POA_QUALITY",
  // onfido_poa_quality_raw keeps the client inside raw_data, so Client rows cannot be a column drill.
  cols: { tl: "tl_name", am: "am_name", analyst: "analyst_email", client: null },
  labels: {
    sample: "Audit Sample", sampleSub: "Yes + No audit base",
    errors: "Errors", errorsSub: "Audits with an error",
    accuracy: "Accuracy",
    errorRate: "Error Rate", errorRateSub: "Errors / (Errors + No Errors)",
  },
};

const EXTERNAL_CONFIG: AuditPageConfig = {
  kind: "external",
  scopeLabel: "External",
  table: "ONFIDO_POA_EXTERNAL_RAW",
  cols: { tl: "tl_name", am: "am_name", analyst: "analyst_email", client: "ims_client_name" },
  labels: {
    sample: "Total Audits", sampleSub: "Yes + No audits",
    errors: "Error", errorsSub: "Yes only",
    accuracy: "External Accuracy",
    errorRate: "External Error Rate", errorRateSub: "Errors / Total QC",
  },
};

export function PoaInternalPage(props: PoaPageProps) {
  return <AuditPage config={INTERNAL_CONFIG} props={props} />;
}

export function PoaExternalPage(props: PoaPageProps) {
  return <AuditPage config={EXTERNAL_CONFIG} props={props} />;
}

export function PoaTrailPage(props: PoaPageProps) {
  const { data, state } = usePoaPage<PoaTrailPayload>("trail", props);
  const { onDrill } = props;
  const onRowClick = onDrill
    ? (row: TrailDetailRow) =>
        onDrill({
          title: `Trail Analyst: ${row.analystEmail}`,
          table: "ONFIDO_POA_TRIAL_RAW",
          filterColumn: "analyst_email",
          filterValue: row.analystEmail,
        })
    : undefined;

  return (
    <div className="space-y-4">
      <NoteBanner notes={data?.notes ?? []} />
      <KpiRow cards={trailCardSpecs(data?.cards)} state={state} />
      <TrailMissChart title="POA Trail SLA - Date-wise Miss SLA vs Not Miss SLA" points={data?.dailyArr ?? []} state={state} />
      <TrailTaskChart title="POA Trail SLA - Date-wise Task, Audits, Error & Error%" points={data?.dailyArr ?? []} state={state} />
      <TrailTable title="POA Trail SLA - Date-wise Miss SLA vs Not Miss SLA" rows={data?.detailRows ?? []} state={state} onRowClick={onRowClick} />
    </div>
  );
}
