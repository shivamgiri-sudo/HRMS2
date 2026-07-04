#!/usr/bin/env tsx
/**
 * Test SMS notification system
 * Usage: tsx backend/scripts/test-sms.ts
 */

import { notificationService } from "../src/services/notification.service.js";

async function testSMS() {
  console.log("=== SMS Notification Test ===\n");

  const testMobile = process.env.TEST_MOBILE || "+919999999999";

  console.log(`Sending test SMS to: ${testMobile}`);
  console.log("Template: REG_CANDIDATE (SMS version)\n");

  try {
    const result = await notificationService.send({
      template_code: "REG_CANDIDATE",
      recipients: [
        {
          type: "candidate",
          mobile: testMobile,
          name: "Test User",
        },
      ],
      context: {
        CandidateName: "Test User",
        Org_Name: "MAS Callnet",
        QToken: "TEST-" + Date.now(),
        RecruiterName: "John",
      },
      channel: "sms", // Force SMS only
    });

    console.log(`✅ Result: sent=${result.sent}, failed=${result.failed}`);

    if (result.sent > 0) {
      console.log("\n✅ SUCCESS! Check your mobile for SMS.");
      console.log("   (Delivery may take 1-2 minutes)");
    } else {
      console.log("\n❌ FAILED! Check:");
      console.log("   1. Twilio config in database (sms_config table)");
      console.log("   2. Account SID and Auth Token are correct");
      console.log("   3. From number is valid Twilio number");
      console.log("   4. Recipient number is whitelisted (if trial account)");
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("\n❌ ERROR:", message);
    console.error("\nTroubleshooting:");
    console.error("1. Ensure migration 132 has been run");
    console.error("2. Insert Twilio config into sms_config table");
    console.error("3. Verify Twilio account is active");
    process.exit(1);
  }
}

// Run test
testSMS().catch(console.error);
