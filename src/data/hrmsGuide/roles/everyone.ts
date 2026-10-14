import type { RoleGuide } from "../types";

/**
 * "Everyone — Getting Started": shown to every signed-in user, whatever their role.
 * Built from AuthClean.tsx, ChangePassword.tsx, TwoFactor.tsx, ResetPassword.tsx,
 * AuthContext.tsx, ProtectedRoute.tsx, WorkforcePageGate.tsx, CompactDashboardLayout.tsx,
 * TopBar.tsx, NotificationBell.tsx, Notifications.tsx, NativeNotificationPreferences.tsx,
 * ModuleLauncher.tsx, Index.tsx, NativeWorkInbox.tsx, CompanyCalendar.tsx, AICommandBar.tsx,
 * CommandPalette.tsx, NativeUatFeedback.tsx, NativeHelpdesk.tsx and PWAInstallBanner.tsx.
 */
export const everyoneGuide: RoleGuide = {
  key: "everyone",
  roleLabel: "Everyone — Getting Started",
  description:
    "The basics every MAS Callnet employee needs in PeopleOS HRMS: signing in safely, finding your pages, keeping up with notifications and your Work Inbox, using the Mira assistant, reporting problems, and knowing who to contact when something is wrong.",
  appRoles: [],
  routine: [
    {
      when: "Every day",
      items: [
        "Sign in with your official email or employee code",
        "Check the bell icon for new notifications",
        "Open Work Inbox and clear anything under 'Needs You'",
        "Ask Mira (bottom-right button or Ctrl+K) for a quick account summary",
      ],
    },
    {
      when: "Every week",
      items: [
        "Look at the Calendar for upcoming holidays and company events",
        "Clear old notifications with 'Mark all read'",
      ],
    },
    {
      when: "When something goes wrong",
      items: [
        "Read the message on screen first — most screens tell you exactly what is missing",
        "Use 'Request Access' on an 'Access not available' screen",
        "Report a broken page from Support → UAT Feedback",
        "Raise a Helpdesk ticket for IT, HR, Payroll, Leave or Attendance problems",
      ],
    },
  ],
  modules: [
    /* ───────────────────────────── SIGN-IN & PASSWORDS ───────────────────────────── */
    {
      id: "sign-in-and-passwords",
      title: "Signing In & Passwords",
      icon: "log-in",
      tone: "indigo",
      summary: "Sign in, change your temporary password, verify the login code and reset a forgotten password.",
      activities: [
        {
          id: "sign-in",
          title: "Sign In to HRMS",
          description: "Open the HRMS login page and sign in with your official email or employee code.",
          path: "/auth",
          frequency: "daily",
          prerequisites: [
            "HR has created your employee record and login",
            "You know your password, or the temporary password HR gave you",
          ],
          steps: [
            { action: "Open the HRMS link in Chrome or Edge.", detail: "If you are already signed in you go straight to your dashboard." },
            {
              action: "In 'Email or Employee Code', type your official email or your employee code.",
              detail: "Both work. The placeholder shows the format: 'name@company.com or EMP001'. Do not add spaces.",
            },
            { action: "Type your password in 'Password'.", detail: "Click the eye icon on the right to check what you typed." },
            { action: "Click 'Sign In'.", detail: "The button shows 'Please wait...' while it checks." },
            {
              action: "Follow the next screen if one appears.",
              detail: "First-time users go to 'Change temporary password'. If login verification is on, you go to 'Verify login' to enter a one-time code. Otherwise you land on your dashboard.",
            },
          ],
          screenGuide:
            "On a computer the left side shows the MAS Callnet branding, branch names and app version. The right side has a white card titled 'Welcome Back' with 'Email or Employee Code', 'Password', a '256-bit encrypted' note, the 'Forgot password?' link and the blue 'Sign In' button. Company announcements scroll in a blue strip under the card, and 'Need help? hr.noida@teammas.in' is shown at the bottom.",
          example:
            "Priya Sharma, an agent at the Noida branch, types her employee code MAS12345, enters her password and clicks 'Sign In'. Login verification is switched on, so she is taken to 'Verify login', where she gets a 6-digit code by SMS.",
          tip: "After 5 wrong passwords in a row your account is locked for 15 minutes. If you are unsure of your password, use 'Forgot password?' instead of guessing.",
          troubleshooting: [
            { q: "'Login Alert — Enter email/employee code and password.'", a: "One of the two boxes is empty. Fill both and click 'Sign In' again." },
            {
              q: "'Login Alert — Invalid credentials'",
              a: "The email/employee code or the password is wrong. Check Caps Lock and that you used your official email (not a personal Gmail). If you still cannot get in, use 'Forgot password?'.",
            },
            {
              q: "'Account temporarily locked due to multiple failed attempts. Please try again later or contact HR.'",
              a: "Five wrong passwords locked the account for 15 minutes. Wait 15 minutes and try again, or reset your password with 'Forgot password?'.",
            },
            {
              q: "'Account is inactive. Please contact HR for assistance.' or 'Account is blocked'",
              a: "Your employee record has been marked inactive (for example after exit) or your login was blocked. Only HR can reactivate it — write to your branch HR or hr.noida@teammas.in.",
            },
            {
              q: "'Authentication service temporarily unavailable. Please try again shortly.' or 'Request timed out. Please try again.'",
              a: "The server is busy or your internet dropped. Wait a minute, check your connection and try again. Your password is not the problem.",
            },
          ],
          tags: ["login", "sign in", "employee code", "EMP code", "password", "locked", "invalid credentials"],
        },
        {
          id: "change-temporary-password",
          title: "Change Your Temporary Password (First Login)",
          description: "Replace the temporary password HR gave you with your own private password.",
          path: "/change-password",
          frequency: "one-time",
          prerequisites: ["You have the temporary password HR shared with you"],
          steps: [
            { action: "Sign in on the login page with your employee code and the temporary password." },
            { action: "You are taken automatically to 'Change temporary password'.", detail: "You cannot open any other page until this is done." },
            { action: "Type the temporary password again in 'Temporary password'." },
            { action: "Type your new password in 'New password' and again in 'Confirm new password'.", detail: "Use at least 8 characters. Mix letters and numbers so it is hard to guess." },
            { action: "Click 'Update password'." },
            {
              action: "Sign in again with your new password.",
              detail: "You see 'Password updated — Please sign in with your new password.' and are sent back to the login page. Login verification (OTP) runs on this next sign-in.",
            },
          ],
          screenGuide:
            "A single white card with a blue lock icon, the title 'Change temporary password' and the line 'Create a private password before entering the HRMS.' It has three password boxes and one 'Update password' button.",
          example:
            "Rahul Verma joins the Gurgaon branch. HR gives him employee code MAS20431 and temporary password Welcome@123. He signs in, enters Welcome@123 as the temporary password, sets Rahul#Grg2024 as his new password twice and clicks 'Update password'. He then signs in again with the new password.",
          tip: "Never share your password with your TL or a colleague. HR and IT will never ask for it.",
          afterThis: "All other sessions for your account are signed out. From now on you sign in with your new password.",
          troubleshooting: [
            { q: "'Password not updated — Use at least 8 characters.'", a: "Your new password is shorter than 8 characters. Choose a longer one." },
            { q: "'Password not updated — The new passwords do not match.'", a: "'New password' and 'Confirm new password' are different. Retype both carefully." },
            { q: "'Password not updated — Current password is incorrect'", a: "The temporary password you typed is wrong. Check it with HR, or use 'Forgot password?' on the login page." },
            {
              q: "Every page keeps sending me back to 'Change temporary password'",
              a: "Your account is still flagged for a forced change. Complete the form; if it keeps returning after a successful update, sign out, sign in again with the new password, and if it still happens tell HR.",
            },
          ],
          tags: ["first login", "temporary password", "change password", "new joiner", "forced password change"],
        },
        {
          id: "verify-login-code",
          title: "Verify Your Login With a One-Time Code (2FA)",
          description: "Enter the 6-digit code sent to your email or mobile to finish signing in.",
          path: "/two-factor",
          frequency: "daily",
          prerequisites: ["Your email or mobile number is correct in your employee record"],
          steps: [
            { action: "After entering your password you land on 'Verify login'." },
            { action: "Choose where to receive the code: click 'Email' or 'SMS'.", detail: "Email goes to your personal email (or official email if no personal one is saved). SMS goes to your personal phone or mobile number on record." },
            { action: "Click 'Send code'.", detail: "You see 'Code sent — Check your email.' or 'Check your sms.'" },
            { action: "Type the 6-digit code in 'Verification code'.", detail: "The 'Verify' button only becomes active once all 6 digits are entered." },
            { action: "Click 'Verify'.", detail: "You see 'Login verified — Your secure session is ready.' and land on your dashboard." },
          ],
          screenGuide:
            "A white card with a green shield icon titled 'Verify login' and the line 'Enter the one-time code sent to your registered contact.' Two buttons 'Email' and 'SMS' pick the channel, a grey 'Send code' button sends it, then a 'Verification code' box and a 'Verify' button.",
          example:
            "Anjali Singh (MAS33102, Kolkata) signs in on a new laptop. On 'Verify login' she picks 'SMS', clicks 'Send code', receives 482913 on her phone and clicks 'Verify'.",
          tip: "Each code is valid for 10 minutes and you get 5 tries. Clicking 'Send code' again cancels the previous code, so always use the latest one.",
          troubleshooting: [
            { q: "'Verification failed — Invalid verification code'", a: "The code was mistyped or is an older one. Check the most recent SMS/email and type it again." },
            { q: "'Verification failed — Verification code expired'", a: "More than 10 minutes passed. Click 'Send code' to get a fresh code." },
            { q: "'Verification attempts exceeded'", a: "Five wrong codes were entered. Click 'Send code' for a new code and enter it carefully." },
            {
              q: "'Code not sent — No sms recipient is available for this account' (or email)",
              a: "HRMS has no mobile number (or email) saved for you. Try the other channel. If neither works, ask HR to update your contact details.",
            },
            { q: "'Code not sent — Email delivery is not configured' or 'SMS delivery failed'", a: "The message service is down. Try the other channel; if both fail, wait a few minutes and contact IT." },
          ],
          tags: ["2FA", "OTP", "two factor", "verification code", "verify login", "SMS code"],
        },
        {
          id: "reset-password-by-sms",
          title: "Reset a Forgotten Password by SMS OTP",
          description: "Get an OTP on your registered mobile and set a new password without contacting HR.",
          path: "/auth",
          frequency: "as-needed",
          prerequisites: ["Your mobile number is saved in your employee record"],
          steps: [
            { action: "On the login page click 'Forgot password?'.", detail: "The card changes to 'Reset Password — Choose how to reset your password'." },
            { action: "Make sure the 'SMS/OTP' tab is selected.", detail: "It is selected by default." },
            { action: "Type your registered 10-digit mobile number (for example 9876543210) and click 'Send OTP'.", detail: "You see 'OTP Sent — If an account exists, an OTP has been sent.'" },
            { action: "Type the OTP in '6-Digit OTP'." },
            { action: "Type a new password of at least 8 characters in 'New Password'." },
            { action: "Click 'Reset Password'.", detail: "You see 'Success — Password reset successful. Please login.' and return to the sign-in form." },
          ],
          screenGuide:
            "The login card shows 'Reset Password' with two tabs, 'Email' and 'SMS/OTP', a mobile number box, and 'Send OTP' / 'Cancel' buttons. After sending, it shows '6-Digit OTP', 'New Password', 'Reset Password' and 'Back'.",
          example:
            "Mohit Kumar (MAS18822, Noida) forgot his password. He clicks 'Forgot password?', enters 9810012345 under 'SMS/OTP', clicks 'Send OTP', enters the code 551203 with a new password and clicks 'Reset Password'.",
          tip: "The OTP is valid for 10 minutes. Enter the number exactly as HR has it — without +91 or spaces works best.",
          troubleshooting: [
            {
              q: "I clicked 'Send OTP' but no SMS arrived",
              a: "For security the screen always says an OTP was sent, even if the number is not on record. Wait a minute, and check the number with HR — it must match the mobile in your employee record. Only 3 OTPs can be requested in 10 minutes.",
            },
            { q: "'Error — Invalid or expired OTP' / 'Invalid OTP'", a: "The OTP is wrong or more than 10 minutes old. Click 'Back', send a new OTP and try again." },
            { q: "'Error — Too many attempts. Request a new OTP.'", a: "Too many wrong OTPs. Click 'Back' and send a fresh OTP." },
            { q: "'Reset Password — Password must be at least 8 characters.'", a: "Choose a longer new password." },
          ],
          tags: ["forgot password", "reset password", "OTP", "SMS", "mobile"],
        },
        {
          id: "reset-password-by-email",
          title: "Reset a Forgotten Password by Email Link",
          description: "Get a reset link on your official email and set a new password.",
          path: "/auth",
          frequency: "as-needed",
          prerequisites: ["You have an official email that is your HRMS login"],
          steps: [
            { action: "On the login page click 'Forgot password?'." },
            { action: "Click the 'Email' tab and type your official email.", detail: "If you had typed your email in the sign-in box, it is filled in for you." },
            { action: "Click 'Send Link'.", detail: "You see 'Reset Link Sent — If this email is registered, a reset link has been sent.'" },
            { action: "Open the email and click the link.", detail: "It opens the 'Set New Password' page." },
            { action: "Enter your new password in 'New Password' and 'Confirm Password', then click 'Update Password'.", detail: "You see 'Password Updated — Your password has been reset. Please log in.'" },
          ],
          screenGuide:
            "The 'Set New Password' page shows the MAS Callnet logo, a lock icon, 'Use at least 8 characters for your new password.', two password boxes and an 'Update Password' button.",
          example:
            "Sneha Rao, a team leader at Gurgaon, enters sneha.rao@teammas.in under 'Email', clicks 'Send Link', opens the email on her phone and sets a new password.",
          tip: "The reset link works for 24 hours and only once. If it has expired, request a new one.",
          troubleshooting: [
            {
              q: "'Email Not Available — Email reset is not set up. Switching to mobile OTP reset.'",
              a: "Email reset is not configured on this server. The screen switches to 'SMS/OTP' — use your mobile number instead.",
            },
            { q: "The link shows 'Invalid or Expired Link'", a: "The link is older than 24 hours or was already used. Click 'Back to Login' and request a new link." },
            { q: "'Error — Passwords don't match.'", a: "'New Password' and 'Confirm Password' are different. Retype both." },
          ],
          tags: ["forgot password", "reset link", "email", "reset password"],
        },
        {
          id: "sign-out",
          title: "Sign Out",
          description: "End your HRMS session safely, especially on a shared floor computer.",
          path: "/dashboard",
          frequency: "daily",
          steps: [
            { action: "Click your photo or initials at the top-right of the screen.", detail: "The 'My Account' menu opens and shows your email." },
            { action: "Click 'Sign out' (in red).", detail: "It shows 'Signing out…' for a moment." },
            { action: "Wait until you see the login page before leaving the computer." },
          ],
          screenGuide: "The 'My Account' menu has 'Profile', 'Settings' and a red 'Sign out' item at the bottom.",
          example: "At the end of her shift, Kavita (MAS40118) clicks her initials 'KA' at the top-right and chooses 'Sign out' before handing the desk to the next shift.",
          tip: "HRMS does not sign you out automatically when you are idle, so always sign out on shared or floor computers.",
          troubleshooting: [
            { q: "I cannot see the 'Sign out' option on my phone", a: "Tap your photo or initials at the top-right corner of the screen; the menu with 'Sign out' opens there." },
          ],
          tags: ["logout", "log out", "sign out", "shared computer"],
        },
      ],
    },

    /* ───────────────────────────── SESSIONS & ACCOUNT STATUS ───────────────────────────── */
    {
      id: "sessions-and-account-status",
      title: "Sessions & Account Status",
      icon: "lock",
      tone: "rose",
      summary: "Why you were signed out, what read-only mode means, and using HRMS on more than one device.",
      activities: [
        {
          id: "understand-sign-out-messages",
          title: "Understand Why You Were Signed Out",
          description: "Read the red message shown when HRMS ends your session and do the right thing next.",
          path: "/auth",
          frequency: "as-needed",
          steps: [
            { action: "Read the title of the red message that appears as you are returned to the login page." },
            {
              action: "If it says 'Signed out — Your password was changed. Please sign in again with your new password.', sign in with your new password.",
              detail: "This happens on every other device after you (or HR) change your password.",
            },
            {
              action: "If it says 'Security sign-out — Unusual activity was detected on your session...', sign in again and change your password if you did not cause it.",
              detail: "HRMS signs out all devices when the same session appears to be used twice.",
            },
            {
              action: "If it says 'Account inactive — Your account has been deactivated. Please contact HR for assistance.', contact HR.",
              detail: "You cannot fix this yourself; HR must reactivate the employee record.",
            },
            { action: "If it says 'Session ended — Please sign in again.', simply sign in again." },
          ],
          screenGuide: "A red pop-up message in the corner of the screen with a short title and one line of explanation, shown on top of the login page.",
          example:
            "Arjun (MAS27765) changed his password on his phone at lunch. When he goes back to the floor computer, it shows 'Signed out — Your password was changed.' He signs in with the new password.",
          tip: "A slow internet connection or a server restart does not sign you out — HRMS quietly retries. You are only signed out when the server has actually ended your session.",
          troubleshooting: [
            {
              q: "I was returned to the login page without any message",
              a: "Your session token expired while the tab was open. Sign in again; if this happens several times a day, tell IT which browser you use.",
            },
            {
              q: "I keep getting 'Security sign-out'",
              a: "Your session is being used from two places, or a browser extension is replaying it. Change your password, sign out on other devices and tell IT if it continues.",
            },
          ],
          tags: ["signed out", "session ended", "logged out", "account inactive", "security sign-out", "session expired"],
        },
        {
          id: "read-only-mode",
          title: "Use HRMS in Read-Only Mode",
          description: "Know what you can still do when your account has been put in read-only mode.",
          path: "/dashboard",
          frequency: "as-needed",
          steps: [
            { action: "Look for the amber strip under the top bar that says 'Your account is in read-only mode. You can view your data but cannot make changes.'" },
            { action: "Use the sidebar to view your Profile, Payslips, Attendance and Leave history as normal.", detail: "Viewing and downloading work. Applying for leave, editing your profile and uploading documents are blocked." },
            { action: "If you need to change something, contact HR — they make the change for you or restore normal access." },
          ],
          screenGuide: "An amber banner with an information icon appears right under the top bar on every page.",
          example:
            "After her last working day, Neha (MAS11290) is given read-only access by HR. She signs in, opens My Space → Pay & Tax → Payslips and downloads her last three payslips for a bank loan.",
          troubleshooting: [
            {
              q: "'Write access denied. Your account is in read-only mode.'",
              a: "You tried to save, submit or upload something. In read-only mode you can only view and download. Ask HR if you need the change made.",
            },
          ],
          tags: ["read only", "inactive employee", "ex-employee", "payslip after exit", "F&F"],
        },
        {
          id: "use-multiple-devices",
          title: "Use HRMS on More Than One Device",
          description: "Understand how your session behaves on your computer, phone and the installed app.",
          path: "/auth",
          frequency: "as-needed",
          steps: [
            { action: "Sign in on each device the normal way.", detail: "Your session stays active on each device until you sign out." },
            {
              action: "If your company has turned on single-device mode, expect the older device to be signed out when you sign in on a new one.",
              detail: "The older device shows 'Session ended — Please sign in again.' the next time it refreshes.",
            },
            { action: "Change your password if you lose a phone that was signed in.", detail: "Changing the password signs out every other device with 'Signed out — Your password was changed.'" },
          ],
          example:
            "Deepak, a TL at Noida, uses HRMS on his desktop and his phone. He loses his phone, so he changes his password from the desktop; the lost phone is signed out immediately.",
          tip: "Your session normally lasts days, not minutes. If you are asked to sign in very often, check that your browser is not set to clear cookies on close.",
          tags: ["mobile", "phone", "two devices", "single device", "session"],
        },
      ],
    },

    /* ───────────────────────────── FINDING YOUR WAY ───────────────────────────── */
    {
      id: "finding-your-way",
      title: "Finding Your Way Around",
      icon: "map",
      tone: "sky",
      summary: "The sidebar, the search box, the mobile menu and the My Modules launcher.",
      activities: [
        {
          id: "use-the-sidebar",
          title: "Use the Sidebar Menu",
          description: "Find any page through the sidebar groups on the left of the screen.",
          path: "/dashboard",
          frequency: "daily",
          steps: [
            {
              action: "Look at the group headings in the dark sidebar on the left.",
              detail: "The groups are 'Overview', 'My Space', 'People & Hiring', 'Workforce', 'Operations', 'Expenses', 'Support' and 'Admin'. You only see the groups and items your role allows.",
            },
            { action: "Click an item to open it.", detail: "Items with an arrow (for example 'Attendance' or 'Leave') open their first page and expand to show more pages under them." },
            { action: "Click the arrow again to collapse the item." },
            { action: "Click your name card at the bottom of the sidebar to open your Profile.", detail: "The version number under it opens the release history." },
          ],
          screenGuide:
            "A dark blue sidebar with the MAS Callnet logo at the top, grouped menu items in the middle and your photo, name and designation at the bottom. The page you are on is highlighted.",
          example:
            "To apply for leave, Ritu opens 'My Space' → 'Leave' → 'Apply Leave'. To see her punches she opens 'My Space' → 'Attendance' → 'My Punch Logs'.",
          tip: "Most of your personal pages live under 'My Space': Profile, Calendar, Attendance, Leave, Pay & Tax, Engage and Comm. Prefs.",
          troubleshooting: [
            {
              q: "A colleague has a menu item I do not have",
              a: "Menu items depend on your role and page access. See 'I can't see a page or menu item' in Troubleshooting & FAQ.",
            },
          ],
          tags: ["menu", "sidebar", "navigation", "where is"],
        },
        {
          id: "search-for-a-page",
          title: "Search for a Page",
          description: "Jump straight to a page by typing its name in the search box at the top.",
          path: "/dashboard",
          frequency: "daily",
          steps: [
            { action: "Click the 'Search...' box in the top bar." },
            { action: "Type part of the page name or what it does, for example 'payslip', 'roster' or 'leave'.", detail: "A 'Navigate' list drops down with up to 7 matching pages." },
            { action: "Click a result to open it, or press Enter to open the first one." },
          ],
          screenGuide: "The search box sits in the white top bar next to the breadcrumb (Home > …). Results show the page icon, name and a short description.",
          example: "Vikas types 'reimb' in 'Search...' and clicks 'My Reimbursements' to raise a travel claim.",
          tip: "Search only finds pages you are allowed to open. If nothing appears, the page may not be in your access — see Troubleshooting & FAQ.",
          troubleshooting: [
            { q: "Search finds nothing for a page I know exists", a: "Try a different word from the menu label (for example 'Punch' instead of 'biometric'). If it still does not appear, you do not have access to that page." },
            { q: "Ctrl+K opened Mira instead of search", a: "Ctrl+K (Cmd+K on Mac) opens the Mira assistant. To search pages, click the 'Search...' box instead." },
          ],
          tags: ["search", "find page", "quick navigation"],
        },
        {
          id: "use-hrms-on-mobile",
          title: "Use HRMS on Your Phone",
          description: "Open the full menu and the quick tabs on a mobile screen.",
          path: "/dashboard",
          frequency: "daily",
          steps: [
            { action: "Tap the menu icon (three lines) at the top-left to open the full sidebar.", detail: "It slides in from the left with every menu group. Tap the X or outside it to close." },
            { action: "Use the bottom bar for the five quick tabs: 'Home', 'People', 'Alerts', 'Attend' and 'Me'.", detail: "They open Dashboard, Employees, Notifications, Attendance and Profile." },
            { action: "Tap your photo at the top-right for the account menu and 'Sign out'." },
          ],
          example: "On the bus, Sameer opens HRMS on his phone, taps 'Attend' to check today's punch-in and 'Alerts' to see that his leave was approved.",
          tip: "The 'People' tab opens the employee directory, which only HR, managers and branch heads can see. Others will see an access message there.",
          tags: ["mobile", "phone", "bottom bar", "menu"],
        },
        {
          id: "open-my-modules",
          title: "Open Any Allowed Page From My Modules",
          description: "See every page your role has access to, grouped by module, on one screen.",
          path: "/modules",
          menuPath: "Overview → My Modules",
          frequency: "as-needed",
          steps: [
            { action: "Open 'Overview → My Modules' from the sidebar." },
            { action: "Check the role chips in the dark header.", detail: "They show the roles HRMS has given you, for example 'employee' or 'tl'." },
            { action: "Scroll the module cards (HRMS, ATS, LMS, WFM, Payroll…) and click a page row to open it." },
          ],
          screenGuide:
            "A dark header titled 'My Modules' with the line 'Every user gets HRMS self-service first...' and your role chips. Below, white cards per module list each allowed page with its name, a short description and an arrow.",
          example: "Pooja has just been made a WFM SPOC. She opens My Modules, sees a new 'WFM' card and clicks 'Roster Workspace' from it.",
          tip: "My Modules is the quickest way to check exactly which roles and pages you hold before asking for access.",
          troubleshooting: [
            { q: "It says 'No module access configured yet.'", a: "No pages are assigned to your role yet. Ask your HR or the Super Admin to check your role assignment." },
            { q: "I do not see 'My Modules' in the sidebar", a: "It is given per role. Use the 'Search...' box or the sidebar groups instead." },
          ],
          tags: ["modules", "launcher", "all pages", "my access", "roles"],
        },
      ],
    },

    /* ───────────────────────────── DASHBOARD ───────────────────────────── */
    {
      id: "your-dashboard",
      title: "Your Dashboard",
      icon: "layout",
      tone: "violet",
      summary: "The home page you land on after signing in.",
      activities: [
        {
          id: "read-your-dashboard",
          title: "Read Your Personal Dashboard",
          description: "See this month's attendance, training status, leave balance and quick links in one place.",
          path: "/dashboard",
          menuPath: "Overview → Dashboard",
          frequency: "daily",
          steps: [
            { action: "Open 'Overview → Dashboard', or click the MAS Callnet logo at the top of the sidebar." },
            { action: "Read 'My Attendance This Month'.", detail: "Cards show 'Present', 'Half Day', 'Absent', 'Late' and 'Attendance %'." },
            { action: "Check 'My Training Status' and 'My Leave Balance'.", detail: "'View Leave Policy' opens the Leave page." },
            {
              action: "Use 'Quick Links' for common jobs.",
              detail: "'Apply Leave', 'View Payslip', 'Raise Helpdesk', 'View Documents', 'Internal Jobs' and 'My Engagement'.",
            },
            { action: "Use the 'Home', 'My KPI' and 'Live Performance' tabs at the top to see your performance figures.", detail: "KPI figures only appear if your process sends KPI data to HRMS." },
          ],
          screenGuide:
            "A header reading 'Welcome, <your name>' with the badge 'Self Service', then attendance cards, a training panel, an 'Automated Attendance & Leave Summary', 'My Leave Balance', 'Source Freshness' and 'Quick Links'.",
          example:
            "Aman (MAS30551, Noida) opens his dashboard on the 18th and sees Present 14, Late 2, Attendance % 93. His leave balance shows 4 EL remaining, so he clicks 'Apply Leave' for his sister's wedding.",
          tip: "Attendance numbers come from finalised attendance. A punch from today may not appear until it is processed.",
          troubleshooting: [
            {
              q: "A red error box says a data source failed (for example 'Attendance: no employee-linked attendance summary was returned')",
              a: "Your login is not yet linked to your employee record, or that source is temporarily down. Click 'Retry'; if it stays, ask HR to check your employee mapping.",
            },
            {
              q: "'No Dashboard Assigned — Your current role does not include a role dashboard.'",
              a: "Your role has no dashboard yet. Use 'Overview → My Modules' or the sidebar to reach your pages, and ask HR to check your role.",
            },
          ],
          tags: ["dashboard", "home", "attendance summary", "leave balance", "quick links"],
        },
        {
          id: "switch-dashboard-tabs",
          title: "Switch Between Role Dashboards",
          description: "Move between the dashboards for each role you hold (for example Manager and My Dashboard).",
          path: "/dashboard",
          menuPath: "Overview → Dashboard",
          frequency: "daily",
          prerequisites: ["You hold more than one role, for example manager and employee"],
          steps: [
            { action: "Open 'Overview → Dashboard'.", detail: "HRMS opens the dashboard for your main role first." },
            { action: "Look at the tab strip under the top bar.", detail: "Tabs can include 'Super Admin', 'CEO', 'HR', 'WFM', 'Payroll', 'Manager', 'Quality', 'Operations', 'Recruiter', 'IT Manager' and 'My Dashboard' — only the ones your roles allow." },
            { action: "Click a tab to switch dashboards." },
            { action: "On role dashboards, use the branch and process filters on the right, and the refresh control to reload the figures." },
          ],
          example: "Sunil, a process manager at Gurgaon, lands on the 'Manager' tab. He clicks 'My Dashboard' to check his own leave balance, then goes back to 'Manager'.",
          troubleshooting: [
            { q: "'Access Restricted — Your assigned roles do not permit access to this dashboard.'", a: "You opened a dashboard your role does not include. Pick another tab or ask HR to review your roles." },
          ],
          tags: ["role dashboard", "tabs", "manager dashboard", "my dashboard"],
        },
      ],
    },

    /* ───────────────────────────── NOTIFICATIONS ───────────────────────────── */
    {
      id: "notifications",
      title: "Notifications & Preferences",
      icon: "bell",
      tone: "amber",
      summary: "The bell, the notification centre and how you want to be contacted.",
      activities: [
        {
          id: "check-the-bell",
          title: "Check New Notifications From the Bell",
          description: "See your latest updates from any page without leaving it.",
          path: "/dashboard",
          frequency: "daily",
          steps: [
            { action: "Look at the bell icon in the top bar.", detail: "A red number shows unread notifications (9+ when more than nine)." },
            { action: "Click the bell to open the 'Notifications' panel." },
            { action: "Click a notification to mark it read and open the related page, if it has one." },
            { action: "Click 'Mark all read' to clear the count, or 'View all notifications' for the full list." },
          ],
          screenGuide:
            "A small panel with the heading 'Notifications'. Each item has a coloured left border (orange for warnings, red for problems, green for success, blue for information), the title, a short message and how long ago it arrived. Unread items show a blue dot.",
          example: "Ravi sees a red 2 on the bell. One reads 'Leave approved' — clicking it opens his Leave page. The other is a payslip-ready alert that opens his payslips.",
          troubleshooting: [
            { q: "The panel says 'No notifications'", a: "You have nothing new. Older items are still on the Notifications page." },
            { q: "Clicking a notification does nothing", a: "Some notifications are information only and have no page link. Read the message and mark it read." },
          ],
          tags: ["bell", "alerts", "unread", "notifications"],
        },
        {
          id: "browse-notification-centre",
          title: "Search and Filter All Your Notifications",
          description: "Find an older notification by category or keyword in the notification centre.",
          path: "/notifications",
          menuPath: "Overview → Notifications",
          frequency: "weekly",
          steps: [
            { action: "Open 'Overview → Notifications' (on mobile, tap 'Alerts')." },
            {
              action: "Click a filter chip: 'All', 'Unread', 'Payroll', 'Attendance', 'Leave', 'Performance', 'Onboarding' or 'Alerts'.",
            },
            { action: "Type a word in 'Search your notifications' to narrow the list." },
            { action: "Click a notification card to open it.", detail: "Cards with an arrow on the right lead to a page." },
            { action: "Click 'Refresh' to load anything new, or 'Mark all read' in the header." },
          ],
          screenGuide:
            "A blue header 'Your updates, in one place' with the 'Unread' count and 'Mark all read'. Three summary tiles ('Portal inbox', 'Unread updates', 'Private delivery'), then the search box with 'Refresh' and 'Preferences' buttons, the filter chips, and the list of cards with category and priority (urgent, high, normal, low).",
          example: "Shalini wants last month's salary credit message. She clicks 'Payroll', types 'credited' and opens the card dated three weeks ago.",
          tip: "Notifications are personal — nobody else sees yours.",
          troubleshooting: [
            { q: "'You are all caught up — No notifications match this view.'", a: "Nothing matches the chip or search you chose. Click 'All' and clear the search box." },
          ],
          tags: ["notification centre", "history", "filter", "search notifications"],
        },
        {
          id: "set-communication-preferences",
          title: "Choose How You Receive Notifications",
          description: "Turn each notification category on or off and pick Email, SMS or WhatsApp for it.",
          path: "/communication/preferences",
          menuPath: "My Space → Comm. Prefs → Comm. Preferences",
          frequency: "one-time",
          steps: [
            { action: "Open 'My Space → Comm. Prefs → Comm. Preferences', or click 'Preferences' on the Notifications page." },
            {
              action: "For each category use the switch next to its name to turn it on or off.",
              detail: "Categories: 'Onboarding', 'Payroll', 'Attendance', 'Leave', 'Performance', 'Alerts' and 'Announcements'.",
            },
            { action: "Pick 'Email', 'SMS' or 'WhatsApp' in the drop-down on the right of each category.", detail: "The drop-down is greyed out when the category is switched off." },
            { action: "Click 'Save Preferences'.", detail: "You see 'Saved — Notification preferences updated successfully'." },
          ],
          screenGuide: "A page titled 'Notification Preferences' with a 'Communication Channels' card. Each row has the category name, an on/off switch, a one-line description and a channel drop-down.",
          example: "Farhan, who has no regular email access on the floor, sets 'Payroll' and 'Leave' to 'WhatsApp' and switches 'Announcements' off, then clicks 'Save Preferences'.",
          tip: "Keep 'Alerts' on — it carries urgent messages such as attendance or security warnings.",
          troubleshooting: [
            { q: "'Error — Failed to save preferences'", a: "The save did not go through. Check your internet and click 'Save Preferences' again." },
            { q: "'Error — Failed to load notification preferences'", a: "Refresh the page. If it keeps failing, report it through Support → UAT Feedback." },
          ],
          tags: ["preferences", "email", "SMS", "WhatsApp", "opt out", "communication settings"],
        },
      ],
    },

    /* ───────────────────────────── WORK INBOX ───────────────────────────── */
    {
      id: "work-inbox",
      title: "Work Inbox",
      icon: "inbox",
      tone: "orange",
      summary: "One list of everything waiting for your action, across every module.",
      activities: [
        {
          id: "understand-work-inbox",
          title: "Understand What Lands in Your Work Inbox",
          description: "Know which tasks appear in Work Inbox and how urgent each one is.",
          path: "/work-inbox",
          menuPath: "Overview → Work Inbox",
          frequency: "daily",
          steps: [
            { action: "Open 'Overview → Work Inbox'.", detail: "A red number next to the title shows how many tasks are pending." },
            {
              action: "Read the five tiles at the top.",
              detail: "'Total Pending', 'Breached TAT' (deadline already passed), 'Due Soon', 'Ageing' (waiting a long time) and 'On Track'.",
            },
            {
              action: "Work the 'Needs You' section first.",
              detail: "It holds breached or due-soon items, urgent and high priority items, and approvals that only you can decide. 'Your Team Can Handle' lists the rest.",
            },
            { action: "Look at the 'Module' column to see where each task comes from.", detail: "For example Leave, Attendance, Exit, BGV, IT, Onboarding, Resignation, PIP, Assets, Visitors, Interviews or Requisitions." },
          ],
          screenGuide:
            "A dark header 'Work Inbox — Your pending tasks across all platform modules' with 'Refresh' and '?' buttons, five coloured KPI tiles, a search box, 'Module' and 'Risk' filter chips, and a table with 'Risk', 'Module', 'Task', 'Priority', age/deadline and 'Actions' columns.",
          example:
            "Meena, a TL at Noida, opens Work Inbox at 10 am. 'Breached TAT' shows 1: a regularization from her agent MAS22011 raised two days ago. It sits at the top of 'Needs You', so she handles it first.",
          tip: "Most employees only see their own requests and reminders here. Managers, HR, WFM, Payroll and IT also get the approvals and tasks assigned to their role.",
          troubleshooting: [
            { q: "'No pending tasks — Great work! Everything is actioned.'", a: "There is nothing waiting for you right now." },
            { q: "'Showing the first batch of results — use filters to narrow down further.'", a: "You have a very long list. Use the 'Module' or 'Risk' chips, or the search box, to see the rest." },
          ],
          tags: ["work inbox", "pending tasks", "TAT", "approvals", "to do"],
        },
        {
          id: "act-on-an-inbox-task",
          title: "Review and Close a Work Inbox Task",
          description: "Open a task, do the work on its page, and mark it done.",
          path: "/work-inbox",
          menuPath: "Overview → Work Inbox",
          frequency: "daily",
          steps: [
            { action: "Click 'Review' on the task row.", detail: "A panel opens on the right with 'Raised by', 'Employee', 'Branch', 'Raised at', 'Aging', 'Deadline', the 'Full Record' and the 'Timeline'." },
            { action: "Click 'Open' to go to the page where the real work is done.", detail: "It opens in a new browser tab, so Work Inbox stays open." },
            { action: "Finish the work on that page (for example approve the regularization or upload the document)." },
            { action: "Back in the panel, add a note under 'Remarks (optional)' or pick one of the 'Quick remarks'." },
            { action: "Click 'Act & Close'.", detail: "The task leaves your list and appears under 'Recently Acted' for this session." },
          ],
          example:
            "Imran in Branch IT sees 'IT provisioning — Domain ID for MAS41207'. He clicks 'Review', then 'Open', creates the domain ID on the IT Provisioning page, returns, types 'Domain ID created' and clicks 'Act & Close'.",
          tip: "'Act' and 'Act & Close' only close the inbox reminder. They do not approve or reject anything by themselves — always finish the real work through 'Open' first.",
          troubleshooting: [
            { q: "'Action failed.'", a: "The task may already have been closed by someone else. Click 'Refresh' to reload the list." },
            { q: "'Reassignment coming in the next update.'", a: "'Reassign' is not available yet. Ask the right person to pick up the task, or finish it yourself." },
          ],
          tags: ["act and close", "review", "complete task", "remarks"],
        },
        {
          id: "approve-reject-from-inbox",
          title: "Approve or Reject Directly From Work Inbox",
          description: "Decide leave, exit clearance, BGV and similar approvals without leaving Work Inbox.",
          path: "/work-inbox",
          menuPath: "Overview → Work Inbox",
          frequency: "daily",
          prerequisites: ["You are the approver for the item (for example the employee's manager)"],
          steps: [
            { action: "Find the approval under 'Needs You' and click 'Review'.", detail: "Approval items such as pending leave, F&F/exit clearance and BGV checks show 'Approve' and 'Reject' instead of 'Act & Close'." },
            { action: "Read the 'Full Record' so you know exactly what you are deciding." },
            { action: "To approve, add an optional note and click 'Approve'." },
            { action: "To reject, type the reason under 'Remarks (required to reject)' and click 'Reject'.", detail: "'Reject' stays disabled until you enter a reason." },
          ],
          example:
            "Process manager Sunil sees 'Leave approval — Kiran Das (MAS19034), 2 days CL'. He clicks 'Review', checks the dates, and clicks 'Approve'. The leave is approved on the real leave record and Kiran is notified.",
          afterThis: "The decision is saved on the real record, exactly as if you had used the module's own page. The requester gets a notification.",
          troubleshooting: [
            { q: "'This item is missing entity information and cannot be actioned.'", a: "The task is not linked to a record. Use 'Open' and decide it from the module page instead." },
          ],
          tags: ["approve", "reject", "leave approval", "F&F", "exit clearance", "BGV"],
        },
        {
          id: "close-grouped-inbox-items",
          title: "Close a Group of Similar Tasks at Once",
          description: "Clear several similar reminders from the same module and branch in one go.",
          path: "/work-inbox",
          menuPath: "Overview → Work Inbox",
          frequency: "weekly",
          steps: [
            { action: "Find a grouped row (three or more similar tasks from the same module and branch are shown together)." },
            { action: "Click 'Expand' to check every item in the group." },
            { action: "Click 'Close All (n)'.", detail: "The row asks 'Close all n items?'." },
            { action: "Click 'Yes, close all' to confirm, or 'Cancel'." },
          ],
          example: "WFM SPOC Ankit has 12 'Attendance — missing punch reminder' items for Noida that are already fixed. He expands the group, checks them, and clicks 'Close All (12)' then 'Yes, close all'.",
          tip: "Urgent items are never grouped. Only close a group when the work behind every item is really done.",
          troubleshooting: [
            { q: "'8 of 12 items closed. 4 were already actioned or not found.'", a: "Some items were closed elsewhere first. Nothing else is needed." },
            { q: "'Bulk action failed. Please try again.'", a: "Nothing was closed. Click 'Refresh' and try again." },
          ],
          tags: ["bulk close", "group", "close all"],
        },
        {
          id: "filter-work-inbox",
          title: "Filter Work Inbox and Use Keyboard Shortcuts",
          description: "Narrow the list by module, risk or keyword and move through it quickly.",
          path: "/work-inbox",
          menuPath: "Overview → Work Inbox",
          frequency: "daily",
          steps: [
            { action: "Type in 'Search title, description, employee or requester…' to find a task by name or employee code." },
            { action: "Click a 'Module' chip to see only that module's tasks.", detail: "Each chip shows its count." },
            { action: "Click a 'Risk' chip: 'all', 'breached', 'due soon', 'aged' or 'on track'." },
            { action: "Click '?' (or press ?) to see shortcuts.", detail: "J / K move between rows, A acts on a row, D opens the review panel, O opens the link, Esc clears the focus." },
          ],
          example: "HR executive Divya types MAS30551 in the search box to see every pending task for that employee before his exit interview.",
          tags: ["filter", "search", "keyboard shortcuts", "risk"],
        },
      ],
    },

    /* ───────────────────────────── CALENDAR ───────────────────────────── */
    {
      id: "company-calendar",
      title: "Company Calendar",
      icon: "calendarDays",
      tone: "teal",
      summary: "Holidays and company events for your planning.",
      activities: [
        {
          id: "view-holidays-and-events",
          title: "Check Holidays and Company Events",
          description: "See the public holidays, company events and all-hands meetings for any month.",
          path: "/calendar",
          menuPath: "My Space → Calendar",
          frequency: "weekly",
          steps: [
            { action: "Open 'My Space → Calendar'." },
            { action: "Read the three tiles: 'Holidays This Month', 'Company Events' and 'Total Events'." },
            { action: "Use the left and right arrows next to the month name to move between months.", detail: "Dates with an event are shown in bold." },
            { action: "Click a date to see its events in the panel on the right.", detail: "Without a selected date, the panel shows 'Upcoming Events' for the month." },
          ],
          screenGuide:
            "A page titled 'Calendar — View holidays and company events', three summary tiles, a month calendar on the left and an events list on the right. Each event shows its type (Public Holiday, Company Event, All-Hands Meeting or Other), the date, and a red 'Holiday' badge when the office is closed.",
          example: "Before applying leave around Diwali, Rohit opens Calendar, moves to November, clicks the 1st and sees 'Diwali — Holiday', so he plans his leave around it.",
          tip: "Only HR and Admin can add, edit or delete events. If a holiday is missing or wrong, tell your branch HR.",
          troubleshooting: [
            { q: "'No events this month'", a: "No holidays or events have been added for that month yet. Check with HR closer to the date." },
          ],
          tags: ["holiday", "holiday list", "calendar", "events", "festival"],
        },
      ],
    },

    /* ───────────────────────────── MIRA ───────────────────────────── */
    {
      id: "mira-assistant",
      title: "Mira — Your HR Assistant",
      icon: "sparkles",
      tone: "purple",
      summary: "Ask Mira about your own salary, leave, attendance and tasks, or report a problem to the HRMS team.",
      activities: [
        {
          id: "open-mira-and-ask",
          title: "Open Mira and Ask a Question",
          description: "Get quick answers about your own HRMS data in plain language.",
          path: "/dashboard",
          frequency: "daily",
          steps: [
            {
              action: "Click the round Mira button with the 'AI' tag at the bottom-right of any page, or press Ctrl+K (Cmd+K on Mac).",
              detail: "Hovering over it shows 'Ask Mira about your HRMS account'. You can drag the button anywhere on the screen.",
            },
            { action: "Pick one of the 'Try asking' prompts, or type your own question in 'Ask about your HRMS data or MAS Callnet…'.", detail: "For example 'How many leaves do I have left?' or 'Summarize my attendance this month'." },
            { action: "Press Enter or click the send arrow.", detail: "Mira shows 'Checking your HRMS account…' and then answers." },
            { action: "Click a suggested button under the answer (for example 'Open leave dashboard') to jump to the right page." },
            { action: "Press Esc or click X to close. Click the circular-arrow icon to clear the conversation." },
          ],
          screenGuide:
            "A chat panel opens on the right with a dark header showing 'Mira', a green 'PRIVATE' badge and 'Live HRMS self-data · Approved company knowledge'. Your messages appear in purple bubbles; Mira's answers in white bubbles with coloured chips for key facts.",
          example: "Sana (MAS28840) presses Ctrl+K and clicks 'Show my latest salary breakup'. Mira lists her gross, deductions and net pay for last month.",
          tip: "Mira only shows your own data and never another employee's personal information. Mira is not shown on the login page.",
          troubleshooting: [
            { q: "'I could not complete that request. Please try again or rephrase the question.'", a: "Mira could not answer this time. Ask again in simpler words, or open the relevant page from the sidebar." },
            { q: "Ctrl+K does nothing", a: "Click once on the page first so the browser window is active, then press Ctrl+K again, or use the Mira button." },
          ],
          tags: ["Mira", "AI", "assistant", "chatbot", "Ctrl+K", "ask"],
        },
        {
          id: "talk-to-mira",
          title: "Talk to Mira by Voice or in Hindi",
          description: "Ask by speaking and have Mira read answers aloud, in Indian English or Hindi.",
          path: "/dashboard",
          frequency: "as-needed",
          steps: [
            { action: "Open Mira and choose 'Indian English' or 'Hindi' in the language drop-down at the bottom." },
            { action: "Click the microphone button and speak your question.", detail: "Allow microphone access when the browser asks. Click it again to stop." },
            { action: "Click the speaker button to turn spoken replies on or off." },
            { action: "Optionally pick a voice in 'Best available Indian voice'." },
          ],
          example: "Ramesh, who prefers Hindi, picks 'Hindi', taps the microphone and asks 'Mera leave balance kitna hai?'. Mira replies and reads the answer aloud.",
          tip: "The microphone is used only while you have it switched on.",
          troubleshooting: [
            { q: "The microphone button is greyed out", a: "Your browser does not support voice input. Use Chrome or Edge, or type your question." },
          ],
          tags: ["voice", "Hindi", "speak", "microphone", "Mira"],
        },
        {
          id: "ask-mira-to-raise-a-request",
          title: "Ask Mira to Draft a Leave, Regularization or Grievance",
          description: "Let Mira prepare a request for you and submit it only after you confirm.",
          path: "/dashboard",
          frequency: "as-needed",
          steps: [
            { action: "Open Mira and type the request in plain words.", detail: "For example 'Apply leave for 23rd August', 'Cancel my leave on 5th', or 'Regularize my attendance for yesterday, I forgot to punch out'." },
            { action: "Read the summary Mira drafts.", detail: "If something is missing, Mira asks a question first." },
            { action: "Click 'Yes, submit it' (or 'Yes, file it' / 'Yes, cancel it') to go ahead, or 'No, cancel' / 'No, keep it' to stop." },
            { action: "Open the suggested page (for example 'Open leave dashboard') to check the request." },
          ],
          example: "Pankaj types 'raise leave for 23rd August, sister's wedding'. Mira drafts one day of leave for 23 Aug; he clicks 'Yes, submit it' and the request goes to his manager.",
          tip: "This works only where the company has switched Mira actions on. If Mira just explains the steps, use the page from the sidebar instead.",
          afterThis: "The request follows the normal approval flow — your manager or HR sees it in their Work Inbox.",
          tags: ["Mira", "apply leave", "regularization", "grievance", "draft"],
        },
        {
          id: "raise-complaint-through-mira",
          title: "Raise a Complaint or Suggestion About HRMS Through Mira",
          description: "Tell Mira about a problem with the HRMS system so it reaches the HRMS admin team.",
          path: "/dashboard",
          frequency: "as-needed",
          steps: [
            {
              action: "Open Mira and describe the problem, naming HRMS or Mira.",
              detail: "For example 'I want to raise a complaint: the HRMS payslip page is not working on my phone' or 'Suggestion for the HRMS app: add a dark mode'.",
            },
            { action: "Send the message.", detail: "Mira replies 'Thanks — I've logged this as … and shared it with the HRMS admin team for review.'" },
            { action: "Click 'Open work inbox' if you want to see your Work Inbox." },
          ],
          example: "Lata types 'Complaint about HRMS: the attendance page shows a blank screen after login'. Mira logs it as a complaint for the admin team.",
          tip: "Use this for problems with the HRMS software itself. For a workplace grievance about a person or policy, use the Helpdesk 'Grievances' tab or ask Mira to file a grievance.",
          afterThis: "The complaint lands in the Super Admin's Work Inbox (and the Mira Complaints page) for review. Bugs and complaints are marked high priority.",
          troubleshooting: [
            { q: "'I couldn't save that … right now due to a temporary issue on my side'", a: "Try again in a few minutes, or report it through Support → UAT Feedback." },
          ],
          tags: ["complaint", "feedback", "suggestion", "Mira", "report problem"],
        },
      ],
    },

    /* ───────────────────────────── REPORTING & HELP ───────────────────────────── */
    {
      id: "report-and-get-help",
      title: "Report a Problem & Get Help",
      icon: "help",
      tone: "cyan",
      summary: "Report a bug, raise a Helpdesk ticket or grievance, and ask for access to a page.",
      activities: [
        {
          id: "report-a-bug-uat",
          title: "Report a Bug Through UAT Feedback",
          description: "Tell the HRMS team about something broken, wrong or missing, with a screenshot.",
          path: "/uat/feedback",
          menuPath: "Support → UAT Feedback",
          frequency: "as-needed",
          prerequisites: ["Open UAT Feedback right after the problem, from the page where it happened, so the page is captured automatically"],
          steps: [
            {
              action: "Open 'Support → UAT Feedback'.",
              detail: "The page title is 'Report UAT feedback'. The page you came from and your browser details are captured automatically.",
            },
            {
              action: "Under 'What kind of issue?' choose 'Something is broken', 'Something is wrong', 'Something is missing' or 'I have a question'.",
            },
            { action: "Under 'How badly does it block you?' choose 'Blocker', 'High', 'Medium' or 'Low'." },
            { action: "Write a 'One-line summary' and describe 'What happened?'.", detail: "The summary needs more than 3 characters and the description more than 10 (4000 maximum)." },
            { action: "Optionally fill 'What did you expect?', 'What happened instead?' and 'Steps to reproduce'." },
            { action: "Check 'Which page?' and correct it if it is wrong, then attach a 'Screenshot' if you have one.", detail: "PNG, JPEG, WebP or GIF, up to 5 MB." },
            { action: "Click 'Submit feedback'.", detail: "You get a reference code to quote later." },
          ],
          screenGuide:
            "A form with a grey 'What happens next' box listing sensitive areas (payroll, attendance rules, login and permissions, payments, database changes) that always go to an engineer. Below are option buttons for issue type and severity, text boxes, the page field, a screenshot picker and 'Submit feedback'.",
          example:
            "On the Leave page, Asha (MAS15520) sees her carry-forward balance as 0 instead of 6. She opens Support → UAT Feedback, picks 'Something is wrong' and 'Medium', types 'Leave balance shows the wrong carry forward', describes it, attaches a screenshot and submits. She receives reference UAT-000142.",
          afterThis:
            "You see 'Thank you, this is recorded' (or 'Recorded — this one needs a person' for sensitive areas). The UAT triage team reviews it and you are asked to retest once a fix is deployed.",
          troubleshooting: [
            { q: "'Submit feedback' stays grey", a: "Write a longer summary (4+ characters) and description (11+ characters)." },
            { q: "'Screenshots only, please — PNG, JPEG, WebP or GIF.' or 'The limit is 5 MB.'", a: "Save the screenshot as PNG or JPEG and keep it under 5 MB (crop it if needed)." },
            {
              q: "'Your report was saved, but the screenshot could not be attached.'",
              a: "Your report is safe. You can add the screenshot to the item later.",
            },
          ],
          tags: ["bug", "UAT", "report issue", "defect", "screenshot", "feedback"],
        },
        {
          id: "join-existing-bug-report",
          title: "Join an Existing Bug Report ('This is mine too')",
          description: "Add yourself to a report someone already raised instead of writing a duplicate.",
          path: "/uat/feedback",
          menuPath: "Support → UAT Feedback",
          frequency: "as-needed",
          steps: [
            { action: "Start typing your 'One-line summary' on the UAT Feedback form." },
            { action: "Watch for the blue box 'Someone may have reported this already'.", detail: "It lists matching reports with their reference, status, how many people are affected and 'same page' when it is the same screen." },
            { action: "If one matches your problem, click 'This is mine too'." },
          ],
          example: "Twenty agents in Noida cannot open My Roster. Vinod types 'My roster page blank' and sees UAT-000210 with 14 people affected; he clicks 'This is mine too' and the count goes to 15.",
          afterThis: "You see 'Added to an existing report'. More people affected moves the report up the queue faster.",
          tags: ["duplicate", "me too", "UAT", "same issue"],
        },
        {
          id: "raise-helpdesk-ticket",
          title: "Raise a Helpdesk Ticket (IT, HR, Payroll, Leave, Attendance)",
          description: "Ask the right support team for help and track the ticket until it is resolved.",
          path: "/helpdesk",
          menuPath: "Overview → Dashboard → Quick Links → Raise Helpdesk",
          frequency: "as-needed",
          steps: [
            { action: "On your dashboard click 'Raise Helpdesk' under 'Quick Links'.", detail: "Managers, HR and Admin can also open 'Support → Helpdesk' from the sidebar." },
            { action: "On the 'Tickets' tab click 'Raise Ticket'." },
            {
              action: "Choose the 'Category': 'IT', 'HR', 'Payroll', 'Admin', 'Asset', 'Leave', 'Attendance' or 'Other', then the 'Priority'.",
            },
            {
              action: "Pick the 'Sub-Category' that matches your problem.",
              detail: "For example 'Desktop Issue — System Hang', 'Salary Issues — Incorrect Deduction', 'Payslip & Documents — Form 16 Request' or 'Punch Issues — Missed Punch'.",
            },
            { action: "For IT tickets, enter 'Agent Downtime (min)' and 'Affected Seats'." },
            { action: "Fill 'Subject *' and 'Description *' and click 'Submit Ticket'.", detail: "You see 'Ticket raised successfully.'" },
          ],
          screenGuide:
            "The 'Helpdesk' page has 'Tickets', 'Grievances' and 'Knowledge Base' tabs, a 'Refresh' button and 'Raise Ticket'. The 'Raise Support Ticket' window has Category, Priority, Sub-Category, Subject and Description.",
          example:
            "Agent Naveen's headset stops working mid-shift at Gurgaon. He raises an 'IT' ticket, sub-category 'Telecom and Voice — Headphone Not Working', priority 'High', Agent Downtime 20, Affected Seats 1.",
          tip: "Search the 'Knowledge Base' tab first — common dialer, softphone and password fixes are written up there.",
          troubleshooting: [
            { q: "'Subject and description are required.'", a: "Fill both 'Subject *' and 'Description *' before clicking 'Submit Ticket'." },
          ],
          tags: ["helpdesk", "ticket", "IT support", "support", "headset", "laptop", "Form 16"],
        },
        {
          id: "raise-a-grievance",
          title: "Raise a Grievance (Optionally Anonymous)",
          description: "Report a workplace concern such as harassment, discrimination, policy or pay issues to HR.",
          path: "/helpdesk",
          menuPath: "Overview → Dashboard → Quick Links → Raise Helpdesk",
          frequency: "as-needed",
          steps: [
            { action: "Open Helpdesk and click the 'Grievances' tab." },
            { action: "Click 'Raise Grievance'." },
            { action: "Choose the 'Category' (workplace, harassment, discrimination, policy, compensation, safety or other) and the 'Severity'." },
            { action: "Tick 'Submit anonymously' if you do not want your name shown." },
            { action: "Fill 'Subject *' and 'Description *' and click 'Submit Grievance'." },
          ],
          example: "An agent who feels a shift supervisor is speaking abusively raises a 'harassment' grievance with severity 'High' and ticks 'Submit anonymously'.",
          afterThis: "HR's grievance team reviews it in the Grievance Command Center and responds through the grievance.",
          tags: ["grievance", "POSH", "harassment", "complaint", "anonymous"],
        },
        {
          id: "request-page-access",
          title: "Request Access to a Page",
          description: "Ask an administrator for access when a page says 'Access not available'.",
          path: "/modules",
          frequency: "as-needed",
          steps: [
            { action: "Open the page you need.", detail: "If your role does not have it, you see 'Access not available — Your current role does not have permission to open this Workforce OS page.'" },
            { action: "Click 'Request Access'." },
            { action: "In 'Request Page Access', explain why you need it.", detail: "For example 'I am the new WFM SPOC for Noida and need this to publish the weekly roster.'" },
            { action: "Click 'Submit Request'.", detail: "You see 'Access request submitted. An admin will review it shortly.'" },
          ],
          example: "New QA analyst Farah opens a QA page and sees 'Access not available'. She clicks 'Request Access', writes that she joined the Quality team on 1 August, and submits.",
          afterThis: "An Admin or the Super Admin reviews the request and approves or denies it. Once approved, sign out and back in so your new access loads.",
          troubleshooting: [
            { q: "'Please enter a reason for your request.'", a: "The reason box is empty. Write one or two lines about why you need the page." },
            { q: "'Failed to submit access request. Please try again.'", a: "Try again in a minute. If it keeps failing, ask your manager to email the Super Admin." },
          ],
          tags: ["access", "permission", "request access", "page access", "RBAC"],
        },
      ],
    },

    /* ───────────────────────────── INSTALL THE APP ───────────────────────────── */
    {
      id: "install-the-app",
      title: "Install HRMS as an App",
      icon: "download",
      tone: "green",
      summary: "Add HRMS to your phone or desktop for one-tap access.",
      activities: [
        {
          id: "install-pwa",
          title: "Install the HRMS App on Your Phone or Computer",
          description: "Install HRMS from the browser so it opens like a normal app.",
          path: "/dashboard",
          frequency: "one-time",
          prerequisites: ["You are using Chrome or Edge on Android, Windows or Mac"],
          steps: [
            { action: "Sign in to HRMS in Chrome or Edge." },
            { action: "Wait for the bar 'Install Mas Callnet HRMS for a faster, app-like experience!' at the bottom of the screen." },
            { action: "Click 'Install', then confirm in the browser's own install window." },
            { action: "Open HRMS from the new icon on your home screen or desktop." },
          ],
          screenGuide: "A white bar with a download icon, the install message, an 'Install' button and an X to dismiss.",
          example: "Field recruiter Sapna installs HRMS on her Android phone from the install bar so she can check walk-in candidates without opening the browser.",
          tip: "If you closed the bar with X, it stays hidden until you open HRMS in a new browser session. On iPhone, open HRMS in Safari, tap Share and choose 'Add to Home Screen'.",
          troubleshooting: [
            { q: "The install bar never appears", a: "Your browser does not offer installing (for example Safari, Firefox or an in-app browser), or HRMS is already installed. Use Chrome or Edge, or the browser menu's 'Install app' option." },
          ],
          tags: ["PWA", "install", "app", "home screen", "mobile app"],
        },
      ],
    },

    /* ───────────────────────────── TROUBLESHOOTING & FAQ ───────────────────────────── */
    {
      id: "troubleshooting-faq",
      title: "Troubleshooting & FAQ",
      icon: "alert",
      tone: "red",
      summary: "What to do when a page is missing, access is denied, your session ends or the data looks wrong.",
      activities: [
        {
          id: "cant-see-a-page",
          title: "I Can't See a Page or Menu Item",
          description: "Find out why a page is missing from your menu and how to get it.",
          path: "/modules",
          menuPath: "Overview → My Modules",
          frequency: "as-needed",
          steps: [
            {
              action: "Remember how menus work.",
              detail: "Each menu item is shown only if your role allows it, or if your role holds that page's access grant (its page code). Two people with different roles see different menus.",
            },
            { action: "Search for the page in the 'Search...' box. If it does not appear, it is not in your access." },
            { action: "Check your roles in 'Overview → My Modules' (the chips in the header)." },
            { action: "If you need the page for your job, open it (ask a colleague for the link) and use 'Request Access', or ask your manager to request it." },
            { action: "Page access is granted by the Super Admin (Admin → Access & Settings → Page Access). After it is granted, sign out and sign in again." },
          ],
          example:
            "Kunal was promoted to TL but still cannot see 'My Team'. HR has not yet added the TL role. He tells his branch HR, who updates his role; after signing out and in again, 'Overview → My Team' appears.",
          tip: "New joiners only see self-service pages until HR finishes their employee record and roles.",
          troubleshooting: [
            { q: "A page disappeared that I used yesterday", a: "Your role or page access was changed. Ask your manager or the Super Admin whether it was intended." },
          ],
          tags: ["missing menu", "page code", "access", "role", "can't find page"],
        },
        {
          id: "access-denied-screens",
          title: "Understand 'Access Denied' Screens",
          description: "Know what each access message means and who can fix it.",
          path: "/dashboard",
          frequency: "as-needed",
          steps: [
            {
              action: "If you see 'Access not available — Your current role does not have permission to open this Workforce OS page.', click 'Request Access'.",
              detail: "Your role does not hold this page's access grant. An admin reviews your request.",
            },
            {
              action: "If you see 'Access Denied — You don't have page access for this HRMS area.' or '…This area is restricted to administrators.', click 'Go to Dashboard'.",
              detail: "The page is limited to certain roles. Ask the Super Admin only if your job really needs it.",
            },
            {
              action: "If you see 'Access Denied — You don't have access to this module. Please complete your onboarding request first.', contact HR.",
              detail: "Your login is not yet linked to an active employee record. HR must finish your onboarding or link your record.",
            },
            {
              action: "If you see 'Access Denied — Only administrators and HR personnel can manage settings.', go back.",
              detail: "This appears when you click 'Settings' in the account menu without an HR or Admin role. Nothing is wrong with your account.",
            },
            {
              action: "If you see 'Unable to verify access' or 'Unable to load page — There was a problem verifying your access.', click 'Refresh Page' or 'Refresh'.",
              detail: "Your permissions failed to load for a moment. If it keeps happening, report it through Support → UAT Feedback.",
            },
          ],
          example: "An agent opens a link a colleague shared to a Payroll page and sees 'Access Denied … restricted to administrators'. This is expected — the page is for the Payroll team only, so she clicks 'Go to Dashboard'.",
          tags: ["access denied", "permission denied", "403", "not allowed", "restricted"],
        },
        {
          id: "session-expired-faq",
          title: "My Session Expired or I Keep Getting Logged Out",
          description: "Get back in and stop repeated sign-outs.",
          path: "/auth",
          frequency: "as-needed",
          steps: [
            { action: "Sign in again on the login page.", detail: "If your saved session is still valid, HRMS may restore it without asking for the password again." },
            { action: "Read any red message shown (see 'Understand Why You Were Signed Out')." },
            { action: "If you are signed out again and again, check that only you are using your account and that your browser is not clearing cookies." },
            { action: "If it continues, raise an IT Helpdesk ticket with your browser name and the time it happened." },
          ],
          example: "Every morning Pradeep finds himself on the login page. IT finds his browser is set to clear cookies when closed and changes the setting.",
          tags: ["session expired", "logged out", "timeout", "login again"],
        },
        {
          id: "wrong-data-faq",
          title: "The Data Looks Wrong or Shows Someone Else's Team",
          description: "Decide whether wrong figures are a data problem, a scope problem or a bug, and who fixes it.",
          path: "/helpdesk",
          frequency: "as-needed",
          steps: [
            { action: "Check the filters on the page (month, branch, process, date range).", detail: "Many pages default to the current month or your own branch." },
            { action: "Click 'Refresh' or reload the page — some figures update only after processing (for example attendance after punches are synced)." },
            {
              action: "If your personal details are wrong (name, bank, PAN, Aadhaar, UAN, mobile), raise an HR request.",
              detail: "Use Helpdesk → HR → 'Employee Records — Personal Details Update'. HR verifies and updates it.",
            },
            {
              action: "If you see the wrong branch, process or team (scope), ask HR to check your branch/process mapping and reporting manager.",
              detail: "What you can see is limited by your mapping. Managers see only their reporting team.",
            },
            { action: "If the page calculates something wrongly, report it through Support → UAT Feedback with a screenshot." },
          ],
          example:
            "TL Geeta sees 3 agents in 'My Team' who moved to another process last week. HR had not updated their reporting manager; once corrected, they disappear from her team.",
          tags: ["wrong data", "scope", "wrong team", "wrong branch", "incorrect", "mapping"],
        },
        {
          id: "how-to-report-a-bug-faq",
          title: "How Do I Report a Bug?",
          description: "Pick the fastest way to get a broken page fixed.",
          path: "/uat/feedback",
          menuPath: "Support → UAT Feedback",
          frequency: "as-needed",
          steps: [
            { action: "For a broken page or wrong calculation, use 'Support → UAT Feedback' (see 'Report a Bug Through UAT Feedback')." },
            { action: "For a quick note while you work, tell Mira, naming HRMS (for example 'Complaint about HRMS: the roster page does not load')." },
            { action: "For a problem with your own salary, leave or attendance record, raise a Helpdesk ticket with the matching category instead." },
            { action: "Always include the page, what you clicked, what you expected and a screenshot." },
          ],
          example: "Murali's 'Apply Leave' button does nothing. He reports it through UAT Feedback as 'Something is broken' with severity 'High', then tells his TL so the leave can be applied manually if urgent.",
          tags: ["bug", "report", "issue", "broken page", "UAT"],
        },
        {
          id: "who-to-contact",
          title: "Who Do I Contact For What?",
          description: "Send each kind of question to the team that can actually solve it.",
          path: "/helpdesk",
          frequency: "as-needed",
          steps: [
            {
              action: "Contact HR for profile and personal details, documents, letters, joining and BGV, leave policy, an inactive account, exits and grievances.",
              detail: "Raise a Helpdesk ticket under 'HR' or write to your branch HR. The login page shows hr.noida@teammas.in.",
            },
            {
              action: "Contact Payroll for salary not credited, wrong deductions, payslips, Form 16, TDS, PF/UAN, ESIC, reimbursements and F&F amounts.",
              detail: "Use 'My Space → Pay & Tax → Salary Disputes' for a salary dispute, or a Helpdesk ticket under 'Payroll'.",
            },
            {
              action: "Contact WFM for roster, shifts, week-offs, missed punches and attendance status.",
              detail: "Raise a regularization from 'My Space → Attendance → Regularization', or a Helpdesk ticket under 'Attendance'.",
            },
            {
              action: "Contact IT for laptop or desktop, headset, dialer, email or domain password, internet and software problems.",
              detail: "Raise a Helpdesk ticket under 'IT' with downtime and affected seats.",
            },
            {
              action: "Contact the Super Admin for page or menu access and role permissions.",
              detail: "Use 'Request Access' on the page, or ask your manager to request it.",
            },
            { action: "Ask your TL or manager about leave approvals, team roster changes and day-to-day work questions." },
          ],
          example:
            "Asif's March payslip shows ₹1,200 PT deducted twice. That is a Payroll question, so he raises a salary dispute from 'Pay & Tax → Salary Disputes' instead of emailing HR.",
          tip: "Not sure? Ask Mira first — she can often answer from your own data or point you to the right page.",
          tags: ["contact", "HR", "Payroll", "WFM", "IT", "support", "who to ask", "escalation"],
        },
      ],
    },
  ],
};
