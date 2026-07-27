from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if new in text:
        return
    if old not in text:
        raise RuntimeError(f"Required pattern not found in {path}: {old[:120]}")
    target.write_text(text.replace(old, new, 1))


replace_once(
    "backend/src/db/runPendingMigrations.ts",
    '  "521_performance_multi_source_lineage.sql",\n',
    '  "521_performance_multi_source_lineage.sql",\n  "522_performance_governance_audit.sql",\n',
)

replace_once(
    "backend/sql/000_run_all.sql",
    "SOURCE sql/510_portal_superadmin_user.sql;\n",
    "SOURCE sql/510_portal_superadmin_user.sql;\n\n"
    "-- ── Governed multi-source performance ingestion (520–522) ───────────────────\n"
    "SOURCE sql/520_performance_ingestion_platform.sql;\n"
    "SOURCE sql/521_performance_multi_source_lineage.sql;\n"
    "SOURCE sql/522_performance_governance_audit.sql;\n",
)

replace_once(
    "backend/scripts/performance-ingestion-install.ts",
    '  "521_performance_multi_source_lineage.sql",\n',
    '  "521_performance_multi_source_lineage.sql",\n  "522_performance_governance_audit.sql",\n',
)
replace_once(
    "backend/scripts/performance-ingestion-install.ts",
    "         (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_metric_master' AND COLUMN_NAME = 'aggregation_method') AS dynamic_metric_column`",
    "         (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_metric_master' AND COLUMN_NAME = 'aggregation_method') AS dynamic_metric_column,\n"
    "         (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'performance_governance_audit') AS governance_audit_table`",
)

routes = Path("backend/src/modules/performance-ingestion/performance-ingestion.routes.ts")
text = routes.read_text()
import_anchor = 'import { performanceGovernanceService } from "./performance-governance.service.js";\n'
if 'performanceDatasetMutationGuard' not in text:
    if import_anchor not in text:
        raise RuntimeError("Governance service import anchor not found")
    text = text.replace(
        import_anchor,
        'import { performanceDatasetMutationGuard } from "./performance-dataset-mutation.guard.js";\n'
        'import { performanceGovernanceAuditMiddleware } from "./performance-governance-audit.middleware.js";\n'
        + import_anchor,
        1,
    )
use_anchor = 'router.use(requireAuth);\n'
if 'router.use(performanceDatasetMutationGuard);' not in text:
    if use_anchor not in text:
        raise RuntimeError("Router auth anchor not found")
    text = text.replace(
        use_anchor,
        'router.use(requireAuth);\n'
        'router.use(performanceDatasetMutationGuard);\n'
        'router.use(performanceGovernanceAuditMiddleware);\n',
        1,
    )
routes.write_text(text)

editor = Path("src/components/performance-hub/PerformanceSourceEditor.tsx")
text = editor.read_text()
key_anchor = '              id="performance-dataset-key"\n              value={form.datasetKey}\n'
key_block = '              id="performance-dataset-key"\n              value={form.datasetKey}\n              disabled={editing}\n'
if 'id="performance-dataset-key"\n              value={form.datasetKey}\n              disabled={editing}' not in text:
    if key_anchor not in text:
        raise RuntimeError("Dataset key input anchor not found")
    text = text.replace(key_anchor, key_block, 1)
editor.write_text(text)

workflow = Path(".github/workflows/performance-platform-validation.yml")
text = workflow.read_text()
needle = '      - "backend/sql/521_performance_multi_source_lineage.sql"\n'
replacement = needle + '      - "backend/sql/522_performance_governance_audit.sql"\n'
if 'backend/sql/522_performance_governance_audit.sql' not in text:
    if needle not in text:
        raise RuntimeError("Performance validation migration path anchor not found")
    text = text.replace(needle, replacement)
workflow.write_text(text)

test = Path("backend/src/modules/performance-ingestion/__tests__/performance-governance.service.test.ts")
text = test.read_text().rstrip()
addition = '''


describe("performance final governance controls", () => {
  const routeCode = fs.readFileSync(
    path.resolve(__dirname, "../performance-ingestion.routes.ts"),
    "utf8",
  );
  const guardCode = fs.readFileSync(
    path.resolve(__dirname, "../performance-dataset-mutation.guard.ts"),
    "utf8",
  );
  const auditCode = fs.readFileSync(
    path.resolve(__dirname, "../performance-governance-audit.middleware.ts"),
    "utf8",
  );

  it("keeps dataset keys immutable and exceptional publication controls admin-only", () => {
    expect(guardCode).toContain("PERFORMANCE_DATASET_KEY_IMMUTABLE");
    expect(guardCode).toContain("PERFORMANCE_EXCEPTIONAL_CONTROL_ADMIN_ONLY");
    expect(guardCode).toContain("allowPartialPublication");
    expect(guardCode).toContain("allowEmptyPublication");
  });

  it("audits successful governance mutations with redaction", () => {
    expect(routeCode).toContain("performanceGovernanceAuditMiddleware");
    expect(auditCode).toContain("performance_governance_audit");
    expect(auditCode).toContain("[REDACTED]");
  });
});
'''
if 'describe("performance final governance controls"' not in text:
    text += addition
test.write_text(text + "\n")
