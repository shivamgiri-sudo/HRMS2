# Data uploader modules

Ad hoc data-load pipelines for Process Performance V2, one **self-contained**
subfolder per company — each folder can be copied on its own to any Windows
machine and run there without the rest of this repo or the other company's
folder. See each subfolder's own `README.md` for setup and Task Scheduler
registration.

- [`housing_premium/`](housing_premium/README.md) — CallerDesk CDR (daily) +
  Google Sheet sale sync (every 15 min) into `db_masmis.Pre_cdr` / `pre_sale`.
- [`housing_owner/`](housing_owner/README.md) — Tata Tele CloudPhone
  Agent Performance CDR (daily) into `db_masmis.Owner_cdr`, plus a
  Google Sheet sale sync (on demand) into `db_masmis.owner_sale`.
- [`lp_feedback/`](lp_feedback/README.md) — IDCloud webconsole Agent Wise
  Performance + Call Register (daily) into `db_masmis.lp_feedback_apr` /
  `lp_feedback_cdr`.
- [`lp_onboarding/`](lp_onboarding/README.md) — same IDCloud webconsole
  pipeline as `lp_feedback/` (different login) into `db_masmis.lp_onboarding_apr`
  / `lp_onboarding_cdr`.
- [`bellavita/`](bellavita/README.md) — manual, on-demand: give it a Sale /
  APR / Chat / Cart export and it checks what's already in `db_masmis.bb_sale`
  / `bb_apr` / `new_bb_chat` / `bb_cart` and imports only what's missing (no
  scheduled pull -- Bellavita's own exports are downloaded by hand).
- [`satya_retail/`](satya_retail/README.md) — direct database-to-database
  sync (no browser automation) from the dialer's own `dialer_db.data_master_in`
  into `db_masmis.satya_cdr`, replacing the manual Satya CDR.xlsx upload.
