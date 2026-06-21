#!/usr/bin/env python3
"""
Process Quality Ranking & Optimal Team Composition Analyzer
Purpose: Execute SQL queries and generate structured analysis output
Output: PROCESS | QUALITY_RANK | VARIANCE | OPTIMAL_SHIFT | FATIGUE_FACTOR
"""

import sys
import json
import subprocess
from datetime import datetime
from typing import Dict, List, Any, Tuple

class ProcessOptimizationAnalyzer:
    def __init__(self, host: str = "122.184.128.90", user: str = "root", password: str = "", db: str = "mas_hrms"):
        self.host = host
        self.user = user
        self.password = password
        self.db = db
        self.results = {
            "metadata": {
                "generated_at": datetime.now().isoformat(),
                "analysis_period": "Last 90 days",
                "source_databases": ["mas_hrms", "db_audit"],
                "queries_executed": 0
            },
            "process_quality_ranking": [],
            "fatigue_cycle_analysis": [],
            "shift_timing_optimization": [],
            "process_shift_matrix": [],
            "team_composition": [],
            "optimization_scorecard": [],
            "summary": {}
        }

    def execute_query(self, query: str) -> List[Dict[str, Any]]:
        """Execute a SQL query and return results as list of dicts"""
        cmd = [
            "mysql",
            "-h", self.host,
            "-u", self.user,
            f"--password={self.password}" if self.password else "",
            self.db,
            "-e", query,
            "--json"
        ]
        cmd = [c for c in cmd if c]  # Remove empty strings

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if result.returncode != 0:
                print(f"Query execution failed: {result.stderr}", file=sys.stderr)
                return []

            # Parse JSON output
            if result.stdout.strip():
                return json.loads(result.stdout)
            return []
        except subprocess.TimeoutExpired:
            print(f"Query timed out after 300 seconds", file=sys.stderr)
            return []
        except Exception as e:
            print(f"Error executing query: {e}", file=sys.stderr)
            return []

    def analyze_process_quality(self) -> None:
        """Query 1: Process Quality Ranking"""
        query = """
        SELECT
          cqa.Campaign as process_name,
          RANK() OVER (ORDER BY AVG(cqa.quality_percentage) DESC) as quality_rank,
          COUNT(DISTINCT cqa.User) as unique_agents,
          ROUND(AVG(cqa.quality_percentage), 2) as avg_quality_score,
          ROUND(STDDEV(cqa.quality_percentage), 2) as quality_variance,
          ROUND(MIN(cqa.quality_percentage), 1) as min_quality,
          ROUND(MAX(cqa.quality_percentage), 1) as max_quality,
          COUNT(*) as total_calls,
          ROUND(COUNT(CASE WHEN cqa.quality_percentage >= 85 THEN 1 END) * 100.0 / COUNT(*), 1) as excellence_rate_pct,
          ROUND(COUNT(CASE WHEN cqa.quality_percentage < 70 THEN 1 END) * 100.0 / COUNT(*), 1) as poor_rate_pct,
          CASE
            WHEN AVG(cqa.quality_percentage) >= 85 THEN 'ELITE'
            WHEN AVG(cqa.quality_percentage) >= 80 THEN 'HIGH'
            WHEN AVG(cqa.quality_percentage) >= 75 THEN 'MEDIUM'
            ELSE 'DEVELOPING'
          END as process_tier
        FROM db_audit.call_quality_assessment cqa
        WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
          AND cqa.quality_percentage IS NOT NULL
          AND cqa.Campaign IS NOT NULL
        GROUP BY cqa.Campaign
        ORDER BY quality_rank ASC
        """
        self.results["process_quality_ranking"] = self.execute_query(query)
        self.results["metadata"]["queries_executed"] += 1

    def analyze_fatigue_cycles(self) -> None:
        """Query 2: Day-of-week and Hour fatigue patterns"""
        query = """
        SELECT
          DAYNAME(cqa.CallDate) as day_of_week,
          HOUR(cqa.CallDate) as hour_of_day,
          COUNT(*) as call_volume,
          COUNT(DISTINCT cqa.User) as unique_agents,
          ROUND(AVG(cqa.quality_percentage), 2) as avg_quality,
          ROUND(STDDEV(cqa.quality_percentage), 2) as quality_variance,
          CASE
            WHEN HOUR(cqa.CallDate) BETWEEN 8 AND 11 THEN 'Morning Peak'
            WHEN HOUR(cqa.CallDate) BETWEEN 12 AND 14 THEN 'Lunch Valley'
            WHEN HOUR(cqa.CallDate) BETWEEN 15 AND 17 THEN 'Afternoon Peak'
            ELSE 'Other'
          END as shift_phase,
          CASE
            WHEN DAYNAME(cqa.CallDate) IN ('Saturday', 'Sunday') THEN 3
            WHEN DAYNAME(cqa.CallDate) = 'Friday' THEN 2
            ELSE 1
          END as fatigue_factor
        FROM db_audit.call_quality_assessment cqa
        WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
          AND cqa.quality_percentage IS NOT NULL
        GROUP BY DAYNAME(cqa.CallDate), HOUR(cqa.CallDate)
        ORDER BY
          FIELD(DAYNAME(cqa.CallDate), 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'),
          HOUR(cqa.CallDate) ASC
        """
        self.results["fatigue_cycle_analysis"] = self.execute_query(query)
        self.results["metadata"]["queries_executed"] += 1

    def analyze_shift_timing(self) -> None:
        """Query 3: Shift timing optimization"""
        query = """
        SELECT
          CASE
            WHEN HOUR(cqa.CallDate) BETWEEN 8 AND 12 THEN 'Morning (8-12)'
            WHEN HOUR(cqa.CallDate) BETWEEN 13 AND 17 THEN 'Afternoon (13-17)'
            WHEN HOUR(cqa.CallDate) BETWEEN 18 AND 22 THEN 'Evening (18-22)'
            ELSE 'Night (0-7/23)'
          END as shift_window,
          ROUND(AVG(cqa.quality_percentage), 2) as avg_quality,
          ROUND(STDDEV(cqa.quality_percentage), 2) as quality_variance,
          COUNT(*) as total_calls,
          COUNT(DISTINCT cqa.User) as unique_agents,
          ROUND(COUNT(CASE WHEN cqa.quality_percentage >= 85 THEN 1 END) * 100.0 / COUNT(*), 1) as excellence_rate_pct,
          ROUND(COUNT(CASE WHEN cqa.quality_percentage >= 80 THEN 1 END) * 100.0 / COUNT(*), 1) as good_rate_pct,
          ROUND(COUNT(CASE WHEN cqa.quality_percentage < 60 THEN 1 END) * 100.0 / COUNT(*), 1) as critical_failure_pct,
          CASE
            WHEN HOUR(cqa.CallDate) BETWEEN 9 AND 11 THEN 'PRIMARY_PEAK'
            WHEN HOUR(cqa.CallDate) BETWEEN 14 AND 16 THEN 'SECONDARY_PEAK'
            ELSE 'OTHER'
          END as shift_classification
        FROM db_audit.call_quality_assessment cqa
        WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
          AND cqa.quality_percentage IS NOT NULL
        GROUP BY
          CASE
            WHEN HOUR(cqa.CallDate) BETWEEN 8 AND 12 THEN 'Morning (8-12)'
            WHEN HOUR(cqa.CallDate) BETWEEN 13 AND 17 THEN 'Afternoon (13-17)'
            WHEN HOUR(cqa.CallDate) BETWEEN 18 AND 22 THEN 'Evening (18-22)'
            ELSE 'Night (0-7/23)'
          END
        ORDER BY avg_quality DESC
        """
        self.results["shift_timing_optimization"] = self.execute_query(query)
        self.results["metadata"]["queries_executed"] += 1

    def analyze_process_shift_matrix(self) -> None:
        """Query 4: Process + Shift combinations"""
        query = """
        SELECT
          cqa.Campaign as process_name,
          CASE
            WHEN HOUR(cqa.CallDate) BETWEEN 8 AND 12 THEN 'Morning'
            WHEN HOUR(cqa.CallDate) BETWEEN 13 AND 17 THEN 'Afternoon'
            WHEN HOUR(cqa.CallDate) BETWEEN 18 AND 22 THEN 'Evening'
            ELSE 'Night'
          END as shift,
          ROUND(AVG(cqa.quality_percentage), 2) as process_shift_quality,
          ROUND(STDDEV(cqa.quality_percentage), 2) as process_shift_variance,
          COUNT(*) as call_volume,
          COUNT(DISTINCT cqa.User) as agent_count,
          ROUND(COUNT(CASE WHEN cqa.quality_percentage >= 80 THEN 1 END) * 100.0 / COUNT(*), 1) as good_rate_pct,
          CASE
            WHEN AVG(cqa.quality_percentage) >= 82 THEN 'PRIMARY_ALLOCATION'
            WHEN AVG(cqa.quality_percentage) >= 78 THEN 'SECONDARY_ALLOCATION'
            ELSE 'AVOID'
          END as allocation_priority
        FROM db_audit.call_quality_assessment cqa
        WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
          AND cqa.quality_percentage IS NOT NULL
          AND cqa.Campaign IS NOT NULL
        GROUP BY
          cqa.Campaign,
          CASE
            WHEN HOUR(cqa.CallDate) BETWEEN 8 AND 12 THEN 'Morning'
            WHEN HOUR(cqa.CallDate) BETWEEN 13 AND 17 THEN 'Afternoon'
            WHEN HOUR(cqa.CallDate) BETWEEN 18 AND 22 THEN 'Evening'
            ELSE 'Night'
          END
        ORDER BY process_shift_quality DESC
        """
        self.results["process_shift_matrix"] = self.execute_query(query)
        self.results["metadata"]["queries_executed"] += 1

    def analyze_team_composition(self) -> None:
        """Query 5: Team composition analysis"""
        query = """
        SELECT
          cqa.Campaign as process_name,
          CASE
            WHEN HOUR(cqa.CallDate) BETWEEN 8 AND 12 THEN 'Morning'
            WHEN HOUR(cqa.CallDate) BETWEEN 13 AND 17 THEN 'Afternoon'
            WHEN HOUR(cqa.CallDate) BETWEEN 18 AND 22 THEN 'Evening'
            ELSE 'Night'
          END as shift,
          COUNT(DISTINCT cqa.User) as current_team_size,
          ROUND(AVG(cqa.quality_percentage), 2) as current_avg_quality,
          ROUND(STDDEV(cqa.quality_percentage), 2) as current_variance,
          ROUND(COUNT(*) / COUNT(DISTINCT cqa.User), 1) as avg_calls_per_agent,
          CASE
            WHEN COUNT(DISTINCT cqa.User) <= 5 THEN 'LEAN'
            WHEN COUNT(DISTINCT cqa.User) <= 10 THEN 'OPTIMAL'
            WHEN COUNT(DISTINCT cqa.User) <= 15 THEN 'STRETCHED'
            ELSE 'OVER_EXTENDED'
          END as current_team_load_status,
          CASE
            WHEN AVG(cqa.quality_percentage) >= 82 AND COUNT(DISTINCT cqa.User) <= 8 THEN 'MAINTAIN_SIZE'
            WHEN AVG(cqa.quality_percentage) < 75 AND COUNT(DISTINCT cqa.User) > 12 THEN 'REDUCE_BY_2'
            ELSE 'MONITOR'
          END as team_composition_recommendation
        FROM db_audit.call_quality_assessment cqa
        WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
          AND cqa.quality_percentage IS NOT NULL
          AND cqa.Campaign IS NOT NULL
        GROUP BY
          cqa.Campaign,
          CASE
            WHEN HOUR(cqa.CallDate) BETWEEN 8 AND 12 THEN 'Morning'
            WHEN HOUR(cqa.CallDate) BETWEEN 13 AND 17 THEN 'Afternoon'
            WHEN HOUR(cqa.CallDate) BETWEEN 18 AND 22 THEN 'Evening'
            ELSE 'Night'
          END
        ORDER BY current_avg_quality DESC
        """
        self.results["team_composition"] = self.execute_query(query)
        self.results["metadata"]["queries_executed"] += 1

    def generate_summary(self) -> None:
        """Generate optimization scorecard summary"""
        if not self.results["process_quality_ranking"]:
            return

        # Top performers
        top_processes = sorted(
            self.results["process_quality_ranking"],
            key=lambda x: x.get("quality_rank", float('inf'))
        )[:3]

        # At-risk processes
        at_risk = [p for p in self.results["process_quality_ranking"] if p.get("process_tier") == "DEVELOPING"]

        # Optimal shifts from analysis
        optimal_shifts = {}
        for shift_data in self.results["shift_timing_optimization"]:
            if shift_data.get("shift_classification") in ["PRIMARY_PEAK", "SECONDARY_PEAK"]:
                optimal_shifts[shift_data.get("shift_window")] = shift_data.get("avg_quality")

        self.results["summary"] = {
            "total_processes": len(self.results["process_quality_ranking"]),
            "total_agents": sum(p.get("unique_agents", 0) for p in self.results["process_quality_ranking"]),
            "total_calls_analyzed": sum(p.get("total_calls", 0) for p in self.results["process_quality_ranking"]),
            "top_performing_processes": [
                {
                    "process": p.get("process_name"),
                    "quality_rank": p.get("quality_rank"),
                    "avg_quality": p.get("avg_quality_score"),
                    "variance": p.get("quality_variance"),
                    "tier": p.get("process_tier")
                } for p in top_processes
            ],
            "at_risk_processes": [
                {
                    "process": p.get("process_name"),
                    "quality_rank": p.get("quality_rank"),
                    "avg_quality": p.get("avg_quality_score"),
                    "variance": p.get("quality_variance"),
                    "action": "Review team composition and training"
                } for p in at_risk
            ],
            "optimal_shifts": optimal_shifts,
            "recommendations": self._generate_recommendations()
        }

    def _generate_recommendations(self) -> List[str]:
        """Generate strategic recommendations"""
        recommendations = []

        # Check variance patterns
        high_variance_processes = [p for p in self.results["process_quality_ranking"]
                                   if p.get("quality_variance", 0) > 12]
        if high_variance_processes:
            recommendations.append(
                f"HIGH_VARIANCE_ALERT: {len(high_variance_processes)} processes show high quality variance (>12). "
                "Recommend team stability audits and consistency training."
            )

        # Check at-risk quality
        poor_quality = [p for p in self.results["process_quality_ranking"]
                       if p.get("avg_quality_score", 0) < 70]
        if poor_quality:
            recommendations.append(
                f"QUALITY_INTERVENTION: {len(poor_quality)} processes below 70% quality. "
                "Immediate action required: coaching, workload reduction, or team restructuring."
            )

        # Optimal shift allocation
        if self.results["shift_timing_optimization"]:
            best_shift = max(self.results["shift_timing_optimization"],
                           key=lambda x: x.get("avg_quality", 0))
            recommendations.append(
                f"SHIFT_OPTIMIZATION: Best performance in {best_shift.get('shift_window')} shift "
                f"(Avg Quality: {best_shift.get('avg_quality')}%). Consider allocating complex work to this window."
            )

        # Team composition
        if self.results["team_composition"]:
            oversized = [t for t in self.results["team_composition"]
                        if t.get("current_team_load_status") == "OVER_EXTENDED"]
            if oversized:
                recommendations.append(
                    f"TEAM_RESTRUCTURING: {len(oversized)} team-shift combinations are over-extended. "
                    "Consider load rebalancing or hiring."
                )

        return recommendations if recommendations else ["Continue monitoring. No immediate action required."]

    def run_analysis(self) -> Dict[str, Any]:
        """Execute all analyses"""
        print("Starting Process Optimization Analysis...", file=sys.stderr)
        self.analyze_process_quality()
        self.analyze_fatigue_cycles()
        self.analyze_shift_timing()
        self.analyze_process_shift_matrix()
        self.analyze_team_composition()
        self.generate_summary()
        print(f"Analysis complete. {self.results['metadata']['queries_executed']} queries executed.", file=sys.stderr)
        return self.results

    def export_csv(self, filename: str = "process-optimization-results.csv") -> None:
        """Export optimization scorecard as CSV"""
        import csv

        scorecard = []
        for process in self.results["process_quality_ranking"]:
            scorecard.append({
                "PROCESS": process.get("process_name"),
                "QUALITY_RANK": process.get("quality_rank"),
                "AVG_QUALITY": process.get("avg_quality_score"),
                "VARIANCE": process.get("quality_variance"),
                "VARIANCE_STATUS": "STABLE" if process.get("quality_variance", 0) < 8 else "MODERATE" if process.get("quality_variance", 0) < 12 else "VOLATILE",
                "MIN_QUALITY": process.get("min_quality"),
                "MAX_QUALITY": process.get("max_quality"),
                "AGENTS": process.get("unique_agents"),
                "CALLS": process.get("total_calls"),
                "EXCELLENCE_RATE": process.get("excellence_rate_pct"),
                "PROCESS_TIER": process.get("process_tier")
            })

        if scorecard:
            with open(filename, 'w', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=scorecard[0].keys())
                writer.writeheader()
                writer.writerows(scorecard)
            print(f"CSV export saved to {filename}", file=sys.stderr)

    def export_json(self, filename: str = "process-optimization-results.json") -> None:
        """Export full analysis as JSON"""
        with open(filename, 'w') as f:
            json.dump(self.results, f, indent=2)
        print(f"JSON export saved to {filename}", file=sys.stderr)


def main():
    # Configuration - update with your database credentials
    HOST = "122.184.128.90"
    USER = "root"
    PASSWORD = "VICIDIALNow"  # Replace with actual password or use env var
    DB = "mas_hrms"

    analyzer = ProcessOptimizationAnalyzer(host=HOST, user=USER, password=PASSWORD, db=DB)

    try:
        results = analyzer.run_analysis()

        # Print JSON to stdout
        print(json.dumps(results, indent=2))

        # Export formats
        analyzer.export_json("process-optimization-results.json")
        analyzer.export_csv("process-optimization-results.csv")

    except Exception as e:
        print(f"Analysis failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
