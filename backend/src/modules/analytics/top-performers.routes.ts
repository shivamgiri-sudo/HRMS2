/**
 * Top Performers Analytics Routes
 *
 * Endpoints:
 * GET /api/analytics/top-performers/summary - Executive summary of top 10% agents
 * GET /api/analytics/top-performers/trait-mastery - Trait comparison data
 * GET /api/analytics/top-performers/teachability - Teachability metrics
 * GET /api/analytics/top-performers/profiles - Detailed top performer profiles
 */

import express, { Request, Response, NextFunction } from 'express';
import {
  getTop10PercentSummary,
  getTraitMasteryComparison,
  getTeachabilityMetrics,
  getTopPerformerProfiles,
  generateExecutiveSummary
} from './top-performers.service.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = express.Router();

/**
 * GET /api/analytics/top-performers/summary
 * Executive summary: top 10% profile, key traits, teachability
 * Access: QA/T&Q Manager, Quality Manager, Operations Manager, HR Admin
 */
router.get('/summary', requireRole('qa', 'operations_manager', 'hr'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const summary = await generateExecutiveSummary();
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/analytics/top-performers/profile
 * Top 10% profile summary (count, avg quality, tenure, etc.)
 */
router.get('/profile', requireRole('qa', 'operations_manager', 'hr'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await getTop10PercentSummary();
    if (!profile) {
      return res.status(404).json({ error: 'No top performer profile data available' });
    }
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/analytics/top-performers/trait-mastery
 * Trait comparison: top 10% vs population
 *
 * Response includes:
 * - trait_name: identifier (e.g., call_answered_within_5_seconds)
 * - trait_label: display name
 * - top_10_pass_rate: % top agents pass this trait
 * - overall_pass_rate: % all agents pass this trait
 * - excellence_delta: difference (top - overall)
 * - excellence_category: KEY_DIFFERENTIATOR | STRONG_ADVANTAGE | MODERATE_ADVANTAGE | MINOR_ADVANTAGE
 */
router.get('/trait-mastery', requireRole('qa', 'operations_manager', 'hr'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const traits = await getTraitMasteryComparison();
    res.json({
      count: traits.length,
      data: traits,
      interpretation: {
        KEY_DIFFERENTIATOR: 'Top 10% score 15%+ higher; primary competitive advantage',
        STRONG_ADVANTAGE: 'Top 10% score 10-15% higher; important but not unique',
        MODERATE_ADVANTAGE: 'Top 10% score 5-10% higher; incremental improvement',
        MINOR_ADVANTAGE: 'Top 10% score <5% higher; baseline skill'
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/analytics/top-performers/teachability
 * Teachability & replication difficulty metrics
 *
 * Response includes:
 * - trait_name: trait identifier
 * - avg_pass_rate_pct: population average pass rate
 * - variance_stddev: standard deviation (consistency measure)
 * - population_mastery_rate: % of all agents who master this trait
 * - teachability_category: HIGH | MODERATE | LOW
 * - replication_difficulty: LOW (<15 stddev) | MODERATE (15-25) | HIGH (>25)
 * - replication_notes: interpretation for coaching programs
 */
router.get('/teachability', requireRole('qa', 'operations_manager', 'hr'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metrics = await getTeachabilityMetrics();
    res.json({
      count: metrics.length,
      data: metrics,
      interpretation: {
        HIGH_TEACHABILITY: 'Systematic skill with low variance; easily replicated through processes/scripts',
        MODERATE_TEACHABILITY: 'Learnable skill requiring coaching; peer mentoring recommended',
        LOW_TEACHABILITY: 'Difficult skill with high variance; personality or experience-driven',
        variance_guidance: 'Lower stddev = more consistent mastery = easier to teach'
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/analytics/top-performers/profiles
 * Detailed profiles of top 10% agents
 *
 * Query params:
 * - limit: max results (default 50)
 *
 * Response includes individual agent:
 * - overall_quality_score: avg quality %
 * - audited_calls: # of calls reviewed
 * - tenure_months: agent experience
 * - trait_response_speed: pass rate
 * - trait_empathy, professionalism, listening, grammar, closure
 * - excellence_profile: ALL_ROUNDED | SPECIALIST | BALANCED
 */
router.get('/profiles', requireRole('qa', 'operations_manager', 'hr'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const profiles = await getTopPerformerProfiles(limit);

    res.json({
      count: profiles.length,
      data: profiles,
      excellence_profile_types: {
        ALL_ROUNDED_EXCELLENCE: 'Excels across all traits (avg 90%+ across 6 traits)',
        SPECIALIST_EXCELLENCE: 'Mastery in specific traits (1+ trait at 95%+)',
        BALANCED_EXCELLENCE: 'Competent across all traits (75-90% range)'
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
