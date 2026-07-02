#!/usr/bin/env tsx
/**
 * Test email notification system
 * Usage: tsx backend/scripts/test-email.ts
 */

import { notificationService } from "../src/services/notification.service.js";

async function testEmail() {
  console.log("=== Email Notification Test ===\n");

  const testEmail = process.env.TEST_EMAIL || "your-email@example.com";

  console.log(`Sending test email to: ${testEmail}`);
  console.log("Template: REG_CANDIDATE\n");

  try {
    const result = await notificationService.send({
      template_code: "REG_CANDIDATE",
      recipients: [
        {
          type: "candidate",
          email: testEmail,
          mobile: "+919999999999",
          name: "Test User",
        },
      ],
      context: {
        CandidateName: "Test User",
        Org_Name: "MAS Callnet",
        RoleApplied: "Customer Service Executive",
        Branch: "Mumbai",
        QToken: "TEST-" + Date.now(),
        RecruiterName: "John Recruiter",
        RecruiterMobile: "+919876543210",
      },
    });

    console.log(`✅ Result: sent=${result.sent}, failed=${result.failed}`);

    if (result.sent > 0) {
      console.log("\n✅ SUCCESS! Check your email inbox.");
      console.log("   (If using Gmail, check spam folder too)");
    } else {
      console.log("\n❌ FAILED! Check:");
      console.log("   1. SMTP config in database (smtp_config table)");
      console.log("   2. Backend logs for error details");
      console.log("   3. notification_log table for error_message");
    }
  } catch (error: any) {
    console.error("\n❌ ERROR:", error.message);
    console.error("\nTroubleshooting:");
    console.error("1. Ensure migration 132 has been run");
    console.error("2. Insert SMTP config into smtp_config table");
    console.error("3. Check database connection");
    process.exit(1);
  }
}

// Run test
testEmail().catch(console.error);
