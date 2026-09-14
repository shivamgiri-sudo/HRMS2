/**
 * Daily Games Content Scheduler
 *
 * Runs every day at 00:05 IST.
 * Fills the next LOOKAHEAD_DAYS of game content for any date that has no row:
 *   - daily_trivia_question
 *   - brain_teaser
 *   - daily_word_puzzle
 *   - daily_tip
 *
 * Content is generated from rotating bank arrays so the cron is zero-touch:
 * add new content to the BANKS below and it will automatically cycle in.
 * Quick polls are not auto-generated — they require approval anyway.
 */

import { randomUUID } from 'node:crypto';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2/promise';

const LOOKAHEAD_DAYS = 14; // always keep at least 14 days ahead filled

// ─── IST scheduler helper (reused pattern from tenure.cron.ts) ──────────────

let _timer: ReturnType<typeof setTimeout> | null = null;

function msUntilNextRun(hour: number, minute: number): number {
  const now = new Date();
  // IST = UTC+5:30
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  const next = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(),
             hour - 5, minute - 30, 0, 0)
  );
  // Correct for negative minutes after subtracting IST offset
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export function startDailyGamesScheduler(): void {
  function scheduleNext() {
    const delay = msUntilNextRun(0, 5); // 00:05 IST
    console.log(`[daily-games] Next content fill in ${Math.round(delay / 60000)} min`);
    _timer = setTimeout(async () => {
      try { await fillDailyGameContent(); }
      catch (e: any) { console.error('[daily-games] Fill error:', e.message); }
      scheduleNext();
    }, delay);
  }
  // Also run once immediately at startup to fill any gaps
  fillDailyGameContent().catch(e =>
    console.error('[daily-games] Startup fill error:', e.message)
  );
  scheduleNext();
}

export function stopDailyGamesScheduler(): void {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

// ─── Content banks ───────────────────────────────────────────────────────────

const TRIVIA_BANK = [
  { category: 'company',  q: 'What does BPO stand for?',                          opts: ['Business Process Outsourcing','Business Plan Operations','Basic Process Order','Brand Planning Office'],      ans: 'A', exp: 'BPO = Business Process Outsourcing — the practice of contracting a business function to a third-party provider.' },
  { category: 'company',  q: 'What does KPI stand for?',                           opts: ['Key Performance Indicator','Knowledge Process Integration','Key Project Index','Knowledge Performance Index'], ans: 'A', exp: 'KPI = Key Performance Indicator — a measurable value that shows how effectively a company is achieving objectives.' },
  { category: 'company',  q: 'What is AHT in a call centre context?',              opts: ['Average Handling Time','Automated Help Tool','Agent Hours Tracked','Annual HR Target'],                    ans: 'A', exp: 'AHT = Average Handling Time — the average duration of one customer interaction including hold and wrap-up.' },
  { category: 'company',  q: 'What does FCR stand for in call centre metrics?',   opts: ['First Call Resolution','Fast Customer Response','Final Complaint Review','Frequent Contact Rate'],         ans: 'A', exp: 'FCR = First Call Resolution — the percentage of calls resolved on the first contact without follow-up.' },
  { category: 'company',  q: 'What does CSAT measure?',                            opts: ['Customer Satisfaction','Call Station Attendance','Cost Savings And Time','Client Service Assessment'],    ans: 'A', exp: 'CSAT = Customer Satisfaction Score — typically a post-interaction survey score.' },
  { category: 'company',  q: 'What does NPS stand for?',                           opts: ['Net Promoter Score','New Process Schedule','National Payroll System','Net Productivity Score'],            ans: 'A', exp: 'NPS = Net Promoter Score — a loyalty metric based on one question: how likely are you to recommend us?' },
  { category: 'industry', q: 'Which country is the world\'s largest BPO hub?',    opts: ['India','Philippines','USA','China'],                                                                         ans: 'A', exp: 'India is the world\'s largest BPO hub, accounting for over 55% of the global offshoring market.' },
  { category: 'industry', q: 'What does SLA stand for in operations?',             opts: ['Service Level Agreement','Staff Leave Allowance','System Log Analysis','Sales Lead Acquisition'],         ans: 'A', exp: 'SLA = Service Level Agreement — a contract that defines the expected service level between provider and customer.' },
  { category: 'industry', q: 'What is "shrinkage" in workforce management?',       opts: ['Time an agent is unavailable for calls','Equipment wear','Customer cancellations','Budget reduction'],    ans: 'A', exp: 'Shrinkage is any time an agent is not available for calls — breaks, training, leaves, meetings, etc.' },
  { category: 'industry', q: 'In WFM, what does "occupancy" measure?',             opts: ['% of time agents handle contacts','Number of agents present','Call volume per hour','Queue wait time'],  ans: 'A', exp: 'Occupancy = the percentage of time an agent spends on calls vs. their total available time.' },
  { category: 'general',  q: 'Which planet is known as the Red Planet?',           opts: ['Mars','Venus','Jupiter','Saturn'],                                                                           ans: 'A', exp: 'Mars gets its reddish colour from iron oxide (rust) on its surface.' },
  { category: 'general',  q: 'How many bones are in the adult human body?',        opts: ['206','210','198','215'],                                                                                     ans: 'A', exp: 'An adult human has 206 bones. Babies are born with around 270 and many fuse over time.' },
  { category: 'general',  q: 'What is the capital of France?',                     opts: ['Paris','Lyon','Marseille','Bordeaux'],                                                                       ans: 'A', exp: 'Paris has been the capital of France since the 10th century.' },
  { category: 'fun',      q: 'What animal is known as the "King of the Jungle"?',  opts: ['Lion','Tiger','Elephant','Gorilla'],                                                                         ans: 'A', exp: 'The lion is called the "King of the Jungle" despite living mainly on open savannahs.' },
  { category: 'fun',      q: 'Which instrument has 88 keys?',                      opts: ['Piano','Accordion','Xylophone','Harpsichord'],                                                               ans: 'A', exp: 'A standard piano has 88 keys — 52 white and 36 black.' },
  { category: 'process',  q: 'What does DPDP stand for in Indian law?',            opts: ['Digital Personal Data Protection','Data Privacy & Processing Protocol','Department of Personal Data Policy','Digital Public Data Programme'], ans: 'A', exp: 'The Digital Personal Data Protection Act 2023 governs how personal data is collected and processed in India.' },
  { category: 'process',  q: 'What does EWS stand for in HR analytics?',           opts: ['Early Warning System','Employee Work Schedule','Engagement Wellness Score','End-of-Week Summary'],        ans: 'A', exp: 'EWS = Early Warning System — a predictive model flagging employees at attrition risk.' },
  { category: 'company',  q: 'What is the full form of ESI in payroll?',           opts: ['Employee State Insurance','Employee Salary Index','Electronic Service Integration','Employment Standard Index'], ans: 'A', exp: 'ESI = Employee State Insurance — a social security scheme under the ESIC Act for workers earning up to ₹21,000/month.' },
  { category: 'company',  q: 'What is the full form of PF in Indian payroll?',     opts: ['Provident Fund','Profit Factor','Performance Fee','Payroll Float'],                                         ans: 'A', exp: 'PF = Provident Fund — a mandatory retirement savings scheme governed by the EPF & MP Act 1952.' },
  { category: 'general',  q: 'How many days are there in a leap year?',            opts: ['366','365','364','367'],                                                                                     ans: 'A', exp: 'A leap year has 366 days — February gets 29 days instead of 28.' },
  { category: 'fun',      q: 'What does "www" stand for in a web address?',        opts: ['World Wide Web','World Wireless Web','Wide Web Window','Web World Wire'],                                   ans: 'A', exp: 'WWW = World Wide Web, invented by Tim Berners-Lee in 1989.' },
  { category: 'industry', q: 'What is "COPC" used for in BPO?',                   opts: ['Customer Operations Performance Centre standard','Cost of Production Control','Customer Order Processing Centre','Call Operations Process Checklist'], ans: 'A', exp: 'COPC is a performance management framework specifically designed for customer experience operations.' },
  { category: 'general',  q: 'Which ocean is the largest?',                        opts: ['Pacific','Atlantic','Indian','Arctic'],                                                                       ans: 'A', exp: 'The Pacific Ocean covers about 165 million km² — more than all the landmasses combined.' },
  { category: 'fun',      q: 'How many sides does a hexagon have?',                opts: ['6','5','7','8'],                                                                                             ans: 'A', exp: 'A hexagon has 6 sides. Hex = six in Greek.' },
  { category: 'process',  q: 'What does RPA stand for in automation?',             opts: ['Robotic Process Automation','Real-time Process Analytics','Remote Process Administration','Rapid Prototype Application'], ans: 'A', exp: 'RPA = Robotic Process Automation — software robots that automate repetitive rule-based tasks.' },
];

const BRAIN_TEASER_BANK = [
  { cat: 'riddle',  q: 'The more you take, the more you leave behind. What am I?', ans: 'footsteps', h1: 'Think about movement', h2: 'Left on a path', exp: 'Each step you take leaves a footprint behind.', pts: [15, 10, 5] },
  { cat: 'riddle',  q: 'I speak without a mouth and hear without ears. I have no body but come alive with the wind. What am I?', ans: 'echo', h1: 'Think about sound', h2: 'Reflects in mountains', exp: 'An echo is a reflection of sound.', pts: [15, 10, 5] },
  { cat: 'logic',   q: 'A rooster lays an egg on top of a barn roof. Which way does it roll?', ans: 'roosters do not lay eggs', h1: 'Think about the animal', h2: 'Only hens lay eggs', exp: 'Roosters are male — they do not lay eggs at all!', pts: [15, 10, 5] },
  { cat: 'math',    q: 'If you have 3 apples and you take away 2, how many do you have?', ans: '2', h1: 'Read carefully', h2: 'What did YOU take?', exp: 'You TOOK 2 apples, so you have 2.', pts: [15, 10, 5] },
  { cat: 'lateral', q: 'A man walks into a restaurant and orders albatross soup. He tastes it, goes home, and kills himself. Why?', ans: 'he realized his wife had died at sea not albatross', h1: 'Why compare soups?', h2: 'What was he eating at sea?', exp: 'He was shipwrecked. His companion told him "albatross" soup — but it was his wife. He recognized the real soup in the restaurant was different.', pts: [15, 10, 5] },
  { cat: 'pattern', q: 'What comes next in the sequence: 2, 6, 12, 20, 30, ?', ans: '42', h1: 'Look at differences: 4, 6, 8, 10...', h2: 'Differences increase by 2', exp: 'Differences are 4,6,8,10,12 → next is 30+12=42.', pts: [15, 10, 5] },
  { cat: 'riddle',  q: 'I have cities but no houses live there. I have mountains but no trees. I have water but no fish. What am I?', ans: 'a map', h1: 'Think about representations', h2: 'Used for navigation', exp: 'A map depicts all these things as symbols but none actually exist on it.', pts: [15, 10, 5] },
  { cat: 'logic',   q: 'How many months have 28 days?', ans: '12', h1: 'Every month has at least...', h2: 'Does January have 28 days too?', exp: 'All 12 months have at least 28 days.', pts: [15, 10, 5] },
  { cat: 'math',    q: 'If there are 6 apples and you take away 4, how many apples do you have?', ans: '4', h1: 'Read: what did YOU take?', h2: 'Not what remains in the bowl', exp: 'You took 4, so you have 4. The bowl has 2 left.', pts: [15, 10, 5] },
  { cat: 'lateral', q: 'A cowboy rides into town on Friday, stays 3 days, and leaves on Friday. How?', ans: 'his horse is named friday', h1: 'Friday is not always a day', h2: 'What else is named Friday?', exp: 'The horse\'s name is Friday!', pts: [15, 10, 5] },
  { cat: 'riddle',  q: 'What has one eye but cannot see?', ans: 'a needle', h1: 'Look for an object', h2: 'Used in sewing', exp: 'A needle has a hole (eye) through which thread is passed.', pts: [15, 10, 5] },
  { cat: 'pattern', q: 'Complete the sequence: 1, 1, 2, 3, 5, 8, 13, ?', ans: '21', h1: 'Each number = sum of two before', h2: '8 + 13 = ?', exp: 'Fibonacci sequence — each term is the sum of the previous two: 13+8=21.', pts: [15, 10, 5] },
  { cat: 'riddle',  q: 'I am always in front of you but cannot be seen. What am I?', ans: 'the future', h1: 'Think abstractly, not physically', h2: 'You are always moving toward it', exp: 'The future is always ahead of you but you can never see or touch it.', pts: [15, 10, 5] },
  { cat: 'logic',   q: 'Is it legal for a man to marry his widow\'s sister?', ans: 'no because he is dead', h1: 'Widow means...', h2: 'What happened to the man?', exp: 'If he has a widow, he is dead — so he cannot marry anyone.', pts: [15, 10, 5] },
  { cat: 'math',    q: 'I add five to nine and get two. How is this possible?', ans: 'it is a clock', h1: 'Think circular, not linear', h2: '9 AM + 5 hours = ?', exp: '9 + 5 = 14 on a 12-hour clock = 2 o\'clock.', pts: [15, 10, 5] },
  { cat: 'riddle',  q: 'What comes once in a minute, twice in a moment, and never in a thousand years?', ans: 'the letter m', h1: 'It is in the words', h2: 'Count letters in each word', exp: 'The letter "m" appears once in "minute", twice in "moment", and not at all in "thousand years".', pts: [15, 10, 5] },
  { cat: 'lateral', q: 'A man is pushing his car along a road when he comes to a hotel. He shouts "I\'m bankrupt!" Why?', ans: 'he is playing monopoly', h1: 'When do you push a car along a board?', h2: 'Think game', exp: 'He is playing Monopoly — his car token landed on a hotel square he cannot afford.', pts: [15, 10, 5] },
  { cat: 'pattern', q: 'What number should replace the question mark? 3, 9, 27, 81, ?', ans: '243', h1: 'Multiply each number...', h2: '81 × 3 = ?', exp: 'Each term is multiplied by 3: 81 × 3 = 243.', pts: [15, 10, 5] },
  { cat: 'riddle',  q: 'What gets wetter the more it dries?', ans: 'a towel', h1: 'Something in your bathroom', h2: 'You use it after a shower', exp: 'A towel absorbs water (gets wetter) as it dries things off.', pts: [15, 10, 5] },
  { cat: 'logic',   q: 'If you drop a yellow hat in the Red Sea, what does it become?', ans: 'wet', h1: 'What happens when anything hits water?', h2: 'Forget the colours', exp: 'Any hat dropped in water becomes wet — the colours are distractions.', pts: [15, 10, 5] },
  { cat: 'riddle',  q: 'What has teeth but cannot bite?', ans: 'a comb', h1: 'Think of everyday objects', h2: 'Used to style hair', exp: 'A comb has teeth (the prongs) but cannot bite.', pts: [15, 10, 5] },
  { cat: 'math',    q: 'A farmer has 17 sheep, all but 9 die. How many sheep does the farmer have?', ans: '9', h1: '"All but" means...', h2: 'How many survived?', exp: '"All but 9 die" means 9 survive. The farmer has 9 sheep.', pts: [15, 10, 5] },
  { cat: 'riddle',  q: 'What can run but never walks, has a mouth but never talks, has a head but never weeps, has a bed but never sleeps?', ans: 'a river', h1: 'Think of nature', h2: 'Has all these parts: mouth, bed, head', exp: 'A river — it runs, has a mouth (where it meets the sea), a source (head), and a bed (riverbed).', pts: [15, 10, 5] },
  { cat: 'lateral', q: 'Before Mount Everest was discovered, what was the highest mountain on Earth?', ans: 'mount everest', h1: 'Did it need to be discovered to exist?', h2: 'Was it always there?', exp: 'Mount Everest was always the highest — it just hadn\'t been discovered yet.', pts: [15, 10, 5] },
  { cat: 'pattern', q: 'What number comes next: 2, 4, 8, 16, 32, ?', ans: '64', h1: 'Each number is doubled', h2: '32 × 2 = ?', exp: 'Each term doubles: 32 × 2 = 64.', pts: [15, 10, 5] },
];

const WORD_BANK = [
  { word: 'SMILE', hint: 'A facial expression of happiness', cat: 'fun' },
  { word: 'LEARN', hint: 'To gain knowledge or skill', cat: 'growth' },
  { word: 'TRUST', hint: 'Belief in reliability of someone', cat: 'values' },
  { word: 'FOCUS', hint: 'Concentrate your attention', cat: 'growth' },
  { word: 'BRAVE', hint: 'Showing courage in difficult situations', cat: 'values' },
  { word: 'CHASE', hint: 'To pursue something with energy', cat: 'fun' },
  { word: 'DRIVE', hint: 'Motivation or travel by vehicle', cat: 'growth' },
  { word: 'SPARK', hint: 'A small flash of fire or inspiration', cat: 'fun' },
  { word: 'CRANE', hint: 'A tall bird or a construction machine', cat: 'fun' },
  { word: 'BLAZE', hint: 'A bright flame or to move fast', cat: 'fun' },
  { word: 'CRISP', hint: 'Fresh, clear, and sharp', cat: 'values' },
  { word: 'GLEAM', hint: 'A bright or shining light', cat: 'fun' },
  { word: 'HARDY', hint: 'Robust and strong', cat: 'values' },
  { word: 'QUIRK', hint: 'A peculiar habit or behaviour', cat: 'fun' },
  { word: 'VIVID', hint: 'Producing powerful feelings or images', cat: 'values' },
  { word: 'PLUCK', hint: 'To pick, or to show courage', cat: 'growth' },
  { word: 'SWARM', hint: 'A large group moving together', cat: 'fun' },
  { word: 'CRAFT', hint: 'Skill or a handmade trade', cat: 'growth' },
  { word: 'PROUD', hint: 'Feeling deep pleasure from achievement', cat: 'values' },
  { word: 'CLEAR', hint: 'Easy to understand, transparent', cat: 'values' },
  { word: 'GRIND', hint: 'Hard work, or to crush something', cat: 'growth' },
  { word: 'FLARE', hint: 'A sudden burst of light or emotion', cat: 'fun' },
  { word: 'MATCH', hint: 'A contest, or something that fits', cat: 'fun' },
  { word: 'VITAL', hint: 'Absolutely necessary', cat: 'values' },
  { word: 'QUEST', hint: 'A long search for something', cat: 'growth' },
  { word: 'SHARP', hint: 'Having a fine edge or quick mind', cat: 'growth' },
  { word: 'BLEND', hint: 'To mix different things together', cat: 'fun' },
  { word: 'THRIVE', hint: 'To grow and succeed', cat: 'growth' },
  { word: 'AGILE', hint: 'Able to move quickly and easily', cat: 'growth' },
  { word: 'GRACE', hint: 'Elegance and politeness', cat: 'values' },
];

const TIP_BANK = [
  { cat: 'wellness',     title: 'Hydration Matters', content: 'Drink at least 8 glasses of water a day. Even mild dehydration reduces concentration by up to 20%. Keep a water bottle on your desk.' },
  { cat: 'productivity', title: 'The Pomodoro Technique', content: 'Work in 25-minute focused sprints followed by a 5-minute break. After 4 sprints, take a longer 15-30 minute break. Studies show this boosts focus significantly.' },
  { cat: 'wellness',     title: 'The 20-20-20 Rule', content: 'Every 20 minutes, look at something 20 feet away for 20 seconds. This simple habit reduces digital eye strain for screen workers.' },
  { cat: 'productivity', title: 'Eat Your Frog First', content: 'Do your hardest task first thing in the morning when willpower is at its peak. Once the "frog" is done, everything else feels easier.' },
  { cat: 'general',      title: 'The 1% Rule', content: 'Improve by just 1% every day. After one year, you\'ll be 37× better than when you started. Small consistent improvements compound dramatically over time.' },
  { cat: 'wellness',     title: 'Power of a Short Walk', content: 'A 10-minute walk boosts mood by up to 25% and increases creative thinking by 60% (Stanford study). Even walking to the pantry counts!' },
  { cat: 'productivity', title: 'Two-Minute Rule', content: 'If a task takes less than 2 minutes — do it now. Scheduling it takes longer than doing it. This removes clutter from your mental queue instantly.' },
  { cat: 'communication',title: 'Active Listening Tips', content: 'Let the speaker finish before responding. Paraphrase what you heard. Ask one clarifying question. Active listening builds trust and prevents 70% of workplace misunderstandings.' },
  { cat: 'wellness',     title: 'Desk Posture Check', content: 'Screen at eye level. Elbows at 90°. Feet flat on the floor. Back supported. 30 seconds to adjust your posture can prevent hours of neck and back pain.' },
  { cat: 'productivity', title: 'The Power of No', content: 'Every time you say yes to something unimportant, you\'re saying no to something important. A polite "not right now" is a productivity superpower.' },
  { cat: 'communication',title: 'Feedback Is a Gift', content: 'When receiving feedback, listen without defending. Say "thank you." Reflect before responding. 90% of high performers actively seek critical feedback.' },
  { cat: 'wellness',     title: 'Breathing to Reduce Stress', content: 'Try box breathing: inhale 4 seconds, hold 4 seconds, exhale 4 seconds, hold 4 seconds. Even one round instantly activates the calm response in your nervous system.' },
  { cat: 'productivity', title: 'Batch Your Emails', content: 'Checking email every 5 minutes costs 30-40% of productive time. Try checking at fixed intervals — morning, post-lunch, end of day — and close the tab otherwise.' },
  { cat: 'general',      title: 'Teach to Learn', content: 'The best way to truly understand something is to explain it to someone else. It reveals gaps in your own knowledge and cements what you know. Try it today!' },
  { cat: 'wellness',     title: 'Sleep Is Productivity', content: 'People who sleep 7-8 hours are 20% more productive than those sleeping 6 hours. Sleep is not wasted time — it\'s when your brain consolidates learning.' },
  { cat: 'productivity', title: 'Set Micro-Goals', content: 'Break big tasks into micro-goals that take 15-30 minutes. Each completion releases dopamine, building momentum. Big goals feel impossible; micro-goals feel achievable.' },
  { cat: 'general',      title: 'The Power of Yet', content: 'Swap "I can\'t do this" with "I can\'t do this yet." That one word shifts you from a fixed mindset to a growth mindset, and changes what you attempt.' },
  { cat: 'wellness',     title: 'Sunlight and Mood', content: 'Try to get 10-15 minutes of natural sunlight in the morning. It sets your body clock, boosts serotonin levels, and improves sleep quality at night.' },
  { cat: 'productivity', title: 'Context Switching Cost', content: 'Switching between tasks costs 20-40% of productivity. Group similar tasks together (all calls, then all emails, then all reports) to protect your deep focus time.' },
  { cat: 'general',      title: 'Reflect Weekly', content: 'Every Friday, write down 3 wins and 1 lesson from the week. This 5-minute habit builds self-awareness and makes you 23% more likely to hit your goals.' },
  { cat: 'wellness',     title: 'Snack Smarter at Work', content: 'Reach for nuts, fruit, or yogurt over biscuits and chips. Protein and complex carbs stabilise blood sugar and prevent the 3pm energy crash.' },
  { cat: 'productivity', title: 'Use Templates', content: 'Create templates for emails, reports, and documents you write repeatedly. Templates reduce decision fatigue and save 30-60 minutes per week on average.' },
  { cat: 'communication',title: 'Ask Better Questions', content: 'Instead of "Why didn\'t this work?" ask "What can I learn from this?" Questions shape thinking. Questions starting with "What" and "How" open possibilities; "Why" often triggers defensiveness.' },
  { cat: 'wellness',     title: 'Gratitude at Work', content: 'Write one thing you\'re grateful for at work each morning. Research shows gratitude journaling for just 3 days reduces stress hormones by 23%.' },
  { cat: 'productivity', title: 'Time Block Your Calendar', content: 'Reserve blocks for deep work (not just meetings) in your calendar. Treat them like meetings you cannot cancel. Even 90 minutes of protected focus time per day is transformative.' },
];

// ─── Content fill logic ───────────────────────────────────────────────────────

function dateStr(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split('T')[0];
}

async function getSystemUserId(): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT au.id FROM auth_user au
     JOIN user_roles ur ON ur.user_id = au.id
     WHERE ur.role_key IN ('super_admin','hr_head','admin') AND au.is_blocked = 0
     ORDER BY FIELD(ur.role_key,'super_admin','hr_head','admin') LIMIT 1`
  );
  return (rows[0]?.id as string) ?? null;
}

// Returns a stable integer index for a given date string (YYYY-MM-DD)
// so that each calendar day always maps to the same bank entry across runs.
function dayIndex(date: string): number {
  // Number of days since a fixed epoch (2024-01-01)
  const epoch = new Date('2024-01-01').getTime();
  return Math.floor((new Date(date).getTime() - epoch) / 86400000);
}

export async function fillDailyGameContent(): Promise<void> {
  const sysUserId = await getSystemUserId();
  const createdBy = sysUserId ?? 'system';

  for (let offset = 0; offset <= LOOKAHEAD_DAYS; offset++) {
    const date = dateStr(offset);
    const idx = dayIndex(date);
    await fillTrivia(date, idx, createdBy);
    await fillBrainTeaser(date, idx, createdBy);
    await fillWordPuzzle(date, idx, createdBy);
    await fillTip(date, idx, createdBy);
  }
  console.log(`[daily-games] Content filled through ${dateStr(LOOKAHEAD_DAYS)}`);
}

async function fillTrivia(date: string, dayIndex: number, createdBy: string) {
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM daily_trivia_question WHERE question_date = ?`, [date]
  );
  if (existing.length > 0) return;

  const entry = TRIVIA_BANK[dayIndex % TRIVIA_BANK.length];
  await db.execute(
    `INSERT INTO daily_trivia_question
       (id, question_date, question_text, category, option_a, option_b, option_c, option_d,
        correct_option, explanation, points_correct, points_participate, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 10, 2, ?)`,
    [randomUUID(), date, entry.q, entry.category,
     entry.opts[0], entry.opts[1], entry.opts[2] ?? null, entry.opts[3] ?? null,
     entry.ans, entry.exp, createdBy]
  );
}

async function fillBrainTeaser(date: string, dayIndex: number, createdBy: string) {
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM brain_teaser WHERE teaser_date = ?`, [date]
  );
  if (existing.length > 0) return;

  const entry = BRAIN_TEASER_BANK[dayIndex % BRAIN_TEASER_BANK.length];
  await db.execute(
    `INSERT INTO brain_teaser
       (id, teaser_date, category, question, answer, hint_1, hint_2, explanation,
        difficulty, points_no_hint, points_one_hint, points_two_hints, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'medium', ?, ?, ?, ?)`,
    [randomUUID(), date, entry.cat, entry.q, entry.ans,
     entry.h1, entry.h2, entry.exp,
     entry.pts[0], entry.pts[1], entry.pts[2], createdBy]
  );
}

async function fillWordPuzzle(date: string, dayIndex: number, createdBy: string) {
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM daily_word_puzzle WHERE puzzle_date = ?`, [date]
  );
  if (existing.length > 0) return;

  const entry = WORD_BANK[dayIndex % WORD_BANK.length];
  await db.execute(
    `INSERT INTO daily_word_puzzle (id, puzzle_date, word, hint, category, difficulty, created_by)
     VALUES (?, ?, ?, ?, ?, 'medium', ?)`,
    [randomUUID(), date, entry.word, entry.hint, entry.cat, createdBy]
  );
}

async function fillTip(date: string, dayIndex: number, createdBy: string) {
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM daily_tip WHERE tip_date = ?`, [date]
  );
  if (existing.length > 0) return;

  const entry = TIP_BANK[dayIndex % TIP_BANK.length];
  await db.execute(
    `INSERT INTO daily_tip (id, tip_date, category, title, content, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), date, entry.cat, entry.title, entry.content, createdBy]
  );
}
