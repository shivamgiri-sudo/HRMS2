# Performance Ingestion Governance Audit

The Performance Hub source-administration workflow uses fail-closed governance controls in addition to ingestion-run lineage.

## Immutable dataset keys

A dataset key becomes immutable after creation. The key is referenced by employee identity mappings, process mappings, mapping exceptions, source lineage, reconciliation evidence, and audit records. Renaming it would orphan historical links, so the backend rejects the change and the editor disables the field for existing datasets.

## Exceptional publication controls

Normal publication is fail closed:

- Any invalid or unmapped row blocks publication.
- An empty source window blocks publication.

The advanced configuration flags below may only be changed by Super Admin or Admin:

```json
{
  "allowPartialPublication": false,
  "allowEmptyPublication": false
}
```

Process Managers and QA Managers can administer sources inside their assigned scope, but cannot enable or disable these exceptional controls.

## Durable audit records

Migration `522_performance_governance_audit.sql` creates `performance_governance_audit`.

Successful mutations record:

- Actor user ID and effective role context
- Action code
- Entity type and entity/dataset ID
- Sanitised pre-change snapshot
- Sanitised request metadata
- Sanitised response evidence
- Timestamp

Covered actions include:

- Dataset create/edit
- Activation/deactivation
- Mapping approval
- Preview and publication
- Employee/process mapping
- Mapping-exception resolution
- Schedule enable/disable/update
- Run-now requests

Potential credential, token, password, secret, and private-key fields are redacted before JSON is written. Audit write failures are logged but do not rewrite or hide the primary operation result.

## Performance Hub audit viewer

Authorised roles see **Performance governance audit** inside Performance Hub. The API applies the same backend process and branch scope used by the source administration module.

The viewer supports:

- Dataset filtering
- Action filtering
- Actor, entity, process, branch, and timestamp review
- Before-change evidence
- Response evidence
- Sanitised request metadata

Process- and branch-scoped users cannot query audit records belonging to another dataset scope by changing frontend parameters.

## Staging verification

After applying migrations 520–522:

```sql
SHOW TABLES LIKE 'performance_governance_audit';

SELECT action_code, entity_type, dataset_id, actor_user_id, created_at
FROM performance_governance_audit
ORDER BY created_at DESC
LIMIT 50;
```

During the pilot, verify one record for each source-governance action before production approval.
