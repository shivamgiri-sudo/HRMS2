Status: DONE
Commits: c43b966b
Backend tsc: clean
Frontend build: clean (built in 15.56s)
Notes: The branch had advanced since the task spec was written — the Signoff tab and SignoffTab component were absent from the current Payroll.tsx. Added: (1) "Signoff" TabsTrigger in the 6-tab TabsList, (2) TabsContent rendering <SignoffTab />, (3) the full SignoffTab function with financeApproveMut, ceoAckMut, revokeMut, markDisbursedMut mutations, TDS Summary card, and Mark as Disbursed button (visible when status==="locked" && finance_approved_at && (no CEO required OR ceo_acknowledged_at) && finance/admin/payroll_head/super_admin role).
