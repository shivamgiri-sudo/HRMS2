#!/usr/bin/env tsx
/**
 * Test all notification templates
 * Usage: tsx backend/scripts/test-all-templates.ts
 */

import { notificationService } from "../src/services/notification.service.js";

const testEmail = process.env.TEST_EMAIL || "your-email@example.com";

async function testTemplate(templateCode: string, context: any) {
  console.log(`\n📧 Testing ${templateCode}...`);

  try {
    const result = await notificationService.send({
      template_code: templateCode,
      recipients: [{ type: "candidate", email: testEmail, name: "Test User" }],
      context,
      channel: "email",
    });

    if (result.sent > 0) {
      console.log(`   ✅ Sent successfully`);
    } else {
      console.log(`   ❌ Failed to send`);
    }

    return result.sent > 0;
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
    return false;
  }
}

async function testAllTemplates() {
  console.log("=== Testing All Email Templates ===");
  console.log(`Recipient: ${testEmail}\n`);

  let passed = 0;
  let failed = 0;

  // 1. REG_CANDIDATE
  if (await testTemplate("REG_CANDIDATE", {
    CandidateName: "John Doe",
    Org_Name: "MAS Callnet",
    RoleApplied: "Customer Service Executive",
    Branch: "Mumbai",
    QToken: "TEST-001",
    RecruiterName: "Sarah Recruiter",
    RecruiterMobile: "+919876543210",
  })) passed++; else failed++;

  // 2. REG_RECRUITER
  if (await testTemplate("REG_RECRUITER", {
    CandidateName: "Jane Smith",
    Mobile: "+919999999999",
    Email: "jane@example.com",
    Branch: "Delhi",
    RoleApplied: "Sales Executive",
    QToken: "TEST-002",
    RecruiterName: "Mike Recruiter",
  })) passed++; else failed++;

  // 3. STAGE_SELECTED
  if (await testTemplate("STAGE_SELECTED", {
    CandidateName: "Bob Johnson",
    StageName: "Round 1- HR Screening",
    RoleApplied: "Team Leader",
    Org_Name: "MAS Callnet",
  })) passed++; else failed++;

  // 4. STAGE_REJECTED
  if (await testTemplate("STAGE_REJECTED", {
    CandidateName: "Alice Williams",
    RoleApplied: "Technical Support",
    Org_Name: "MAS Callnet",
  })) passed++; else failed++;

  // 5. FINAL_SELECTED
  if (await testTemplate("FINAL_SELECTED", {
    CandidateName: "Charlie Brown",
    RoleApplied: "Senior Agent",
    OfferDOJ: "2026-07-01",
    OfferShift: "9 AM - 6 PM",
    OfferSalary: "18000",
    CandidateConfirmLink: "https://forms.example.com/confirm",
    Day1DocFormLink: "https://forms.example.com/docs",
    Day1Docs: "- Aadhaar\n- PAN\n- Certificates",
    Org_Name: "MAS Callnet",
  })) passed++; else failed++;

  // 6. SLA_BREACH
  if (await testTemplate("SLA_BREACH", {
    CandidateName: "David Davis",
    QToken: "TEST-003",
    RecruiterName: "Emma Recruiter",
    Branch: "Bangalore",
    RoleApplied: "Voice Process",
    SLAMinutes: "45",
  })) passed++; else failed++;

  console.log("\n=== Test Summary ===");
  console.log(`✅ Passed: ${passed}/6`);
  console.log(`❌ Failed: ${failed}/6`);

  if (passed === 6) {
    console.log("\n🎉 ALL TESTS PASSED! Notification system is working perfectly.");
  } else if (passed > 0) {
    console.log("\n⚠️  PARTIAL SUCCESS. Check failed templates.");
  } else {
    console.log("\n❌ ALL TESTS FAILED. Check SMTP configuration.");
  }
}

testAllTemplates().catch(console.error);
