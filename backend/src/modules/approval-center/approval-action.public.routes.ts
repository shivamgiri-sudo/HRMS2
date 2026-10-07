import { Router } from "express";
import express from "express";
import { env } from "../../config/env.js";
import { confirmPage, messagePage } from "./email-render.js";
import { executeActionToken, itemForToken, loadActionToken } from "./email-action.service.js";

/**
 * PUBLIC (no login) — the Approve / Decline buttons in approval emails land here.
 * GET only ever renders; the decision is a POST, so mail scanners / link previews that open links cannot decide anything.
 */
export const approvalActionPublicRouter = Router();
approvalActionPublicRouter.use(express.urlencoded({ extended: false, limit: "20kb" }));

const home = () => env.FRONTEND_URL.replace(/\/+$/, "");
const noStore = (res: any) => res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" });

approvalActionPublicRouter.get("/:token", async (req, res) => {
  noStore(res);
  try {
    const row = await loadActionToken(req.params.token);
    if (!row) return res.status(404).send(messagePage("er", "Link not valid", "This link is not valid.", home()));
    if (row.used_at) return res.send(messagePage("nt", "Already actioned", "This request was already decided with this link.", home()));
    if (row.expired) return res.send(messagePage("er", "Link expired", "This link has expired. Open HRMS to decide.", home()));
    const item = await itemForToken(row);
    if (!item) return res.send(messagePage("nt", "No longer pending", "This request is no longer waiting for you — it may already have been actioned.", home()));
    const pre = req.query.do === "reject" ? "reject" : "approve";
    return res.send(confirmPage(item, req.params.token, pre));
  } catch {
    return res.status(500).send(messagePage("er", "Something went wrong", "Please open HRMS to decide.", home()));
  }
});

approvalActionPublicRouter.post("/:token", async (req, res) => {
  noStore(res);
  const action = req.body?.action === "reject" ? "reject" : req.body?.action === "approve" ? "approve" : null;
  if (!action) return res.status(400).send(messagePage("er", "Choose an action", "Please choose Approve or Decline.", home()));
  const remarks = typeof req.body?.remarks === "string" ? req.body.remarks.slice(0, 2000) : "";
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.slice(0, 254) : "";
    const out = await executeActionToken(req.params.token, action, remarks, String(req.ip ?? ""), email);
    if (out.ok) {
      return res.send(messagePage("ok", action === "approve" ? "Approved" : "Declined", action === "approve" ? "Your approval has been recorded." : "The request has been declined.", home()));
    }
    if (out.reason === "error" || out.reason === "email") {
      // Claim was released: show the page again with the reason so the approver can fix it (e.g. add a note) and retry.
      const row = await loadActionToken(req.params.token);
      const item = row ? await itemForToken(row).catch(() => null) : null;
      if (item) return res.status(422).send(confirmPage(item, req.params.token, action, out.message));
    }
    return res.status(out.reason === "invalid" ? 404 : 409).send(messagePage(out.reason === "gone" ? "nt" : "er", "Not actioned", out.message, home()));
  } catch {
    return res.status(500).send(messagePage("er", "Something went wrong", "Nothing was changed. Please open HRMS to decide.", home()));
  }
});
