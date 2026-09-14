-- Seeds the communication_template row for JOB_REQUISITION_RAISED, read by
-- templateService.getTemplateByName('job_requisition_raised'). Deliberately a
-- DB row, not a file-only templates/*.hbs — a file-only template 404s
-- "Template not found" in prod unless the deployed build actually ships the
-- templates/ directory tree, which is not guaranteed.
--
-- category='alerts': communication_template.category is an ENUM with no
-- 'recruitment' value (040_communication.sql), and extending the ENUM is out
-- of scope for this change.
--
-- Idempotent: the WHERE NOT EXISTS guard means re-running this file is safe,
-- and matters here because communication_template.name carries no UNIQUE
-- constraint — a second insert would leave two active rows and
-- getTemplateByName (no ORDER BY/LIMIT) would pick whichever the query
-- planner returns first.
INSERT INTO communication_template
  (id, name, subject, body_html, body_text, category, channel, is_active, created_by)
SELECT UUID(), 'job_requisition_raised',
  'Requisition Raised: {{requisitionCode}} — {{designationName}} at {{branchName}}',
  '<p>A new requisition has been raised for approval.</p>
   <table>
     <tr><td>Requisition</td><td>{{requisitionCode}}</td></tr>
     <tr><td>Designation</td><td>{{designationName}}</td></tr>
     <tr><td>Branch</td><td>{{branchName}}</td></tr>
     <tr><td>Process</td><td>{{processName}}</td></tr>
     <tr><td>Headcount</td><td>{{requestedHeadcount}}</td></tr>
     <tr><td>Priority</td><td>{{priority}}</td></tr>
   </table>
   <p><a href="{{actionUrl}}">Review in PeopleOS</a></p>',
  'A new requisition has been raised for approval.\nRequisition: {{requisitionCode}}\nDesignation: {{designationName}}\nBranch: {{branchName}}\nProcess: {{processName}}\nHeadcount: {{requestedHeadcount}}\nReview: {{actionUrl}}',
  'alerts', 'email', 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'job_requisition_raised');
