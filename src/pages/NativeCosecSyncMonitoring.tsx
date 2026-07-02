import PeopleOSDataPage from "./PeopleOSDataPage";

export default function NativeCosecSyncMonitoring() {
  return (
    <PeopleOSDataPage
      eyebrow="Integrations"
      title="COSEC Sync Monitoring"
      endpoint="/api/integrations/cosec/sync-status"
      primaryKeys={["status"]}
    />
  );
}
