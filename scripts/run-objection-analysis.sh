#!/bin/bash

##############################################################################
# Objection Analysis CLI
# Quick-start script to generate objection reports from the HRMS backend
##############################################################################

set -e

# Configuration
BACKEND_URL="${BACKEND_URL:-http://localhost:5055}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
OUTPUT_DIR="${OUTPUT_DIR:-./objection-reports}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_DIR="${OUTPUT_DIR}/${TIMESTAMP}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Check prerequisites
check_requirements() {
    print_header "Checking Requirements"

    if ! command -v curl &> /dev/null; then
        print_error "curl is not installed"
        exit 1
    fi
    print_success "curl found"

    if ! command -v jq &> /dev/null; then
        print_error "jq is not installed"
        exit 1
    fi
    print_success "jq found"

    if [ -z "$AUTH_TOKEN" ]; then
        print_error "AUTH_TOKEN environment variable not set"
        print_info "Set it with: export AUTH_TOKEN='your-jwt-token'"
        exit 1
    fi
    print_success "AUTH_TOKEN configured"
}

# Validate backend connectivity
test_connection() {
    print_header "Testing Backend Connection"

    response=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $AUTH_TOKEN" \
        "$BACKEND_URL/api/quality-dashboard/objections/health")

    http_code=$(echo "$response" | tail -n1)

    if [ "$http_code" = "200" ]; then
        print_success "Connected to $BACKEND_URL"
    elif [ "$http_code" = "401" ]; then
        print_error "Unauthorized - invalid AUTH_TOKEN"
        exit 1
    elif [ "$http_code" = "403" ]; then
        print_error "Forbidden - insufficient permissions"
        exit 1
    else
        print_error "Connection failed (HTTP $http_code)"
        exit 1
    fi
}

# Create output directory
setup_output() {
    print_header "Setting Up Output Directory"

    mkdir -p "$REPORT_DIR"
    print_success "Created: $REPORT_DIR"
}

# Fetch individual reports
fetch_report() {
    local endpoint=$1
    local filename=$2
    local limit=${3:-50}

    print_info "Fetching: $endpoint (limit=$limit)"

    curl -s \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        "$BACKEND_URL/api/quality-dashboard/objections/$endpoint?limit=$limit" \
        | jq '.' > "$REPORT_DIR/$filename"

    if [ -s "$REPORT_DIR/$filename" ]; then
        print_success "Saved: $filename"
    else
        print_error "Failed to fetch: $endpoint"
    fi
}

# Fetch comprehensive report
fetch_comprehensive() {
    print_info "Fetching: comprehensive-report"

    curl -s \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        "$BACKEND_URL/api/quality-dashboard/objections/comprehensive-report?patternLimit=50&handlerLimit=50&processLimit=100&rebuttalLimit=100" \
        | jq '.' > "$REPORT_DIR/comprehensive-report.json"

    if [ -s "$REPORT_DIR/comprehensive-report.json" ]; then
        print_success "Saved: comprehensive-report.json"
    else
        print_error "Failed to fetch comprehensive report"
    fi
}

# Convert JSON to CSV
convert_to_csv() {
    local json_file=$1
    local csv_file=$2
    local jq_filter=$3

    print_info "Converting: $(basename $json_file) → $(basename $csv_file)"

    if [ -f "$json_file" ]; then
        jq -r "$jq_filter" < "$json_file" > "$csv_file"
        print_success "Converted: $csv_file"
    fi
}

# Generate CSV files from JSON reports
generate_csv() {
    print_header "Generating CSV Files"

    # Top Patterns CSV
    convert_to_csv \
        "$REPORT_DIR/patterns.json" \
        "$REPORT_DIR/top-objections.csv" \
        '.patterns | ["OBJECTION", "COUNT", "RESOLUTION_RATE", "SALES_AFTER", "CONVERSION_RATE"] | @csv, (.[] | [.OBJECTION, .CALL_COUNT, .RESOLUTION_RATE_PCT, .SALES_AFTER_OBJECTION, .SALES_CLOSE_RATE_AFTER_OBJECTION_PCT] | @csv) | @csv'

    # Top Handlers CSV
    convert_to_csv \
        "$REPORT_DIR/handlers.json" \
        "$REPORT_DIR/top-handlers.csv" \
        '.handlers | ["HANDLER_CODE", "HANDLER_NAME", "OBJECTIONS_HANDLED", "UNIQUE_TYPES", "SALES_CLOSE_RATE_PCT", "SALES_CLOSED"] | @csv, (.[] | [.HANDLER_CODE, .HANDLER_NAME, .OBJECTIONS_HANDLED, .UNIQUE_OBJECTION_TYPES, .SALES_CLOSE_RATE_AFTER_OBJ_PCT, .SALES_CLOSED_COUNT] | @csv) | @csv'

    # Sales Metrics CSV
    convert_to_csv \
        "$REPORT_DIR/sales-metrics.json" \
        "$REPORT_DIR/sales-metrics.csv" \
        '.metrics | ["OBJECTION", "RAISED_COUNT", "HANDLED_COUNT", "SALES_CLOSED", "CONVERSION_RATE_PCT"] | @csv, (.[] | [.OBJECTION, .OBJECTION_RAISED_COUNT, .HANDLED_COUNT, .SALES_CLOSED_AFTER_HANDLING, .CONVERSION_RATE_AFTER_HANDLING_PCT] | @csv) | @csv'
}

# Generate summary report
generate_summary() {
    print_header "Generating Summary Report"

    local health_file="$REPORT_DIR/health.json"

    if [ -f "$health_file" ]; then
        cat > "$REPORT_DIR/SUMMARY.txt" << 'EOF'
╔══════════════════════════════════════════════════════════════════╗
║         OBJECTION ANALYSIS REPORT - EXECUTIVE SUMMARY            ║
╚══════════════════════════════════════════════════════════════════╝

Generated: $(date)

─────────────────────────────────────────────────────────────────────

KEY METRICS
───────────

Total Objections Raised:             $(jq -r '.dashboard.TOTAL_OBJECTIONS_RAISED' $health_file)
Unique Objection Types:              $(jq -r '.dashboard.UNIQUE_OBJECTION_TYPES' $health_file)
Total Objections Handled:            $(jq -r '.dashboard.TOTAL_OBJECTIONS_HANDLED' $health_file)
Overall Resolution Rate:             $(jq -r '.dashboard.OVERALL_RESOLUTION_RATE_PCT' $health_file)%
Sales Closed After Objection:        $(jq -r '.dashboard.SALES_CLOSED_AFTER_OBJECTION_HANDLING' $health_file)
Sales Conversion Rate:               $(jq -r '.dashboard.SALES_CONVERSION_AFTER_OBJECTION_PCT' $health_file)%
Unique Handlers:                     $(jq -r '.dashboard.UNIQUE_HANDLERS' $health_file)
Unique Clients:                      $(jq -r '.dashboard.UNIQUE_CLIENTS' $health_file)
Unique Processes:                    $(jq -r '.dashboard.UNIQUE_PROCESSES' $health_file)

─────────────────────────────────────────────────────────────────────

TOP 5 OBJECTION TYPES
──────────────────────
EOF

        jq -r '.topPatterns[0:5] | .[] | "\(.OBJECTION) (\(.CALL_COUNT) calls, \(.RESOLUTION_RATE_PCT)% resolution, \(.SALES_CLOSE_RATE_AFTER_OBJECTION_PCT)% conversion)"' \
            "$REPORT_DIR/comprehensive-report.json" >> "$REPORT_DIR/SUMMARY.txt"

        cat >> "$REPORT_DIR/SUMMARY.txt" << 'EOF'

─────────────────────────────────────────────────────────────────────

TOP 5 OBJECTION HANDLERS
────────────────────────
EOF

        jq -r '.topHandlers[0:5] | .[] | "\(.HANDLER_NAME) (\(.OBJECTIONS_HANDLED) handled, \(.SALES_CLOSE_RATE_AFTER_OBJ_PCT)% conversion)"' \
            "$REPORT_DIR/comprehensive-report.json" >> "$REPORT_DIR/SUMMARY.txt"

        print_success "Generated: SUMMARY.txt"
    fi
}

# Generate HTML dashboard
generate_html() {
    print_header "Generating HTML Dashboard"

    cat > "$REPORT_DIR/dashboard.html" << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Objection Analysis Report</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px; }
        .container { max-width: 1400px; margin: 0 auto; }
        h1 { color: #333; margin-bottom: 30px; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .metric-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .metric-value { font-size: 32px; font-weight: bold; color: #2196F3; }
        .metric-label { font-size: 14px; color: #666; margin-top: 8px; }
        .chart-container { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 30px; position: relative; height: 400px; }
        table { width: 100%; border-collapse: collapse; background: white; margin-bottom: 30px; }
        thead { background: #f5f5f5; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { font-weight: bold; color: #333; }
        tr:hover { background: #f9f9f9; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Objection Analysis Report</h1>

        <div class="metrics">
            <div class="metric-card">
                <div class="metric-value" id="totalObjections">0</div>
                <div class="metric-label">Total Objections Raised</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="resolutionRate">0%</div>
                <div class="metric-label">Overall Resolution Rate</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="conversionRate">0%</div>
                <div class="metric-label">Sales Conversion Rate</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="totalHandlers">0</div>
                <div class="metric-label">Active Handlers</div>
            </div>
        </div>

        <div class="chart-container">
            <canvas id="topObjectionsChart"></canvas>
        </div>

        <div class="chart-container">
            <canvas id="topHandlersChart"></canvas>
        </div>

        <h2>Top Objections</h2>
        <table id="objectionsTable">
            <thead>
                <tr>
                    <th>Objection</th>
                    <th>Count</th>
                    <th>Resolution Rate</th>
                    <th>Sales After</th>
                    <th>Conversion Rate</th>
                </tr>
            </thead>
            <tbody id="objectionsBody"></tbody>
        </table>

        <h2>Top Handlers</h2>
        <table id="handlersTable">
            <thead>
                <tr>
                    <th>Handler</th>
                    <th>Objections Handled</th>
                    <th>Unique Types</th>
                    <th>Sales Closed</th>
                    <th>Conversion Rate</th>
                </tr>
            </thead>
            <tbody id="handlersBody"></tbody>
        </table>
    </div>

    <script>
        // Load and render data
        async function loadReport() {
            try {
                const response = await fetch('comprehensive-report.json');
                const data = await response.json();
                const report = data.report;

                // Update metrics
                document.getElementById('totalObjections').textContent = report.dashboard.TOTAL_OBJECTIONS_RAISED;
                document.getElementById('resolutionRate').textContent = report.dashboard.OVERALL_RESOLUTION_RATE_PCT + '%';
                document.getElementById('conversionRate').textContent = report.dashboard.SALES_CONVERSION_AFTER_OBJECTION_PCT + '%';
                document.getElementById('totalHandlers').textContent = report.dashboard.UNIQUE_HANDLERS;

                // Top Objections Chart
                const topObj = report.topPatterns.slice(0, 10);
                const objChart = new Chart(document.getElementById('topObjectionsChart'), {
                    type: 'bar',
                    data: {
                        labels: topObj.map(o => o.OBJECTION),
                        datasets: [{
                            label: 'Count',
                            data: topObj.map(o => o.CALL_COUNT),
                            backgroundColor: '#2196F3'
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false }
                });

                // Top Handlers Chart
                const topHnd = report.topHandlers.slice(0, 10);
                const hndChart = new Chart(document.getElementById('topHandlersChart'), {
                    type: 'bar',
                    data: {
                        labels: topHnd.map(h => h.HANDLER_NAME),
                        datasets: [{
                            label: 'Sales Close Rate (%)',
                            data: topHnd.map(h => h.SALES_CLOSE_RATE_AFTER_OBJ_PCT),
                            backgroundColor: '#4CAF50'
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false }
                });

                // Top Objections Table
                const objBody = document.getElementById('objectionsBody');
                topObj.forEach(o => {
                    objBody.innerHTML += `
                        <tr>
                            <td>${o.OBJECTION}</td>
                            <td>${o.CALL_COUNT}</td>
                            <td>${o.RESOLUTION_RATE_PCT}%</td>
                            <td>${o.SALES_AFTER_OBJECTION}</td>
                            <td>${o.SALES_CLOSE_RATE_AFTER_OBJECTION_PCT}%</td>
                        </tr>
                    `;
                });

                // Top Handlers Table
                const hndBody = document.getElementById('handlersBody');
                topHnd.forEach(h => {
                    hndBody.innerHTML += `
                        <tr>
                            <td>${h.HANDLER_NAME}</td>
                            <td>${h.OBJECTIONS_HANDLED}</td>
                            <td>${h.UNIQUE_OBJECTION_TYPES}</td>
                            <td>${h.SALES_CLOSED_COUNT}</td>
                            <td>${h.SALES_CLOSE_RATE_AFTER_OBJ_PCT}%</td>
                        </tr>
                    `;
                });
            } catch (err) {
                console.error('Failed to load report:', err);
            }
        }

        loadReport();
    </script>
</body>
</html>
EOF

    print_success "Generated: dashboard.html"
}

# Print results summary
print_results() {
    print_header "Report Generation Complete"

    echo "Report saved to: $REPORT_DIR"
    echo ""
    echo "Generated Files:"
    ls -lh "$REPORT_DIR" | awk 'NR>1 {print "  " $9 " (" $5 ")"}'
    echo ""
    echo "View Results:"
    echo "  • JSON: open $REPORT_DIR/comprehensive-report.json"
    echo "  • CSV:  open $REPORT_DIR/top-*.csv"
    echo "  • HTML: open $REPORT_DIR/dashboard.html"
    echo "  • Text: cat $REPORT_DIR/SUMMARY.txt"
}

# Main execution
main() {
    print_header "OBJECTION ANALYSIS REPORT GENERATOR"

    check_requirements
    test_connection
    setup_output

    print_header "Fetching Reports"
    fetch_report "patterns" "patterns.json" 50
    fetch_report "handlers" "handlers.json" 50
    fetch_report "sales-metrics" "sales-metrics.json" 50
    fetch_report "by-process" "by-process.json" 100
    fetch_report "rebuttals" "rebuttals.json" 100
    fetch_report "health" "health.json"
    fetch_comprehensive

    generate_csv
    generate_summary
    generate_html
    print_results
}

# Run main function
main
