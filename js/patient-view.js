import { loadSharedHeader } from "./main.js";

// Configuration
const ACTIVITY_NAMES = { "SC": "Stair Climbing", "STS": "Sit-To-Stand", "TUG": "Timed Up & Go", "W": "Walking" };
const ACTIVITIES = ["SC", "STS", "TUG", "W"];
const ALL_PATIENTS_DATA_PATH = "data/dashboard_data.csv";
const ACTIVITY_METRICS = {
    "W": ["IPI_left_mean_sec", "IPI_left_std_sec", "IPI_right_mean_sec", "IPI_right_std_sec", "cadence_total_steps_min", "symmetry_ratio", "GA_signed_pct", "composite_score"],
    "STS": ["step_time_mean_sec", "step_time_std_sec", "cycle_time_mean_sec", "cycle_time_std_sec", "composite_score"],
    "TUG": ["IPI_left_mean_sec", "IPI_left_std_sec", "IPI_right_mean_sec", "IPI_right_std_sec", "cadence_total_steps_min", "symmetry_ratio", "GA_signed_pct", "composite_score"],
    "SC": ["step_time_mean_sec", "step_time_std_sec", "cycle_time_mean_sec", "cycle_time_std_sec", "composite_score"]
};
const METRIC_UNITS = {
    step_time_mean_sec: "s",
    step_time_std_sec: "s",
    cycle_time_mean_sec: "s",
    cycle_time_std_sec: "s",
    IPI_left_mean_sec: "s",
    IPI_left_std_sec: "s",
    IPI_right_mean_sec: "s",
    IPI_right_std_sec: "s",
    cadence_total_steps_min: "steps/min",
    symmetry_ratio: "-",
    GA_signed_pct: "%",
    GSI_pct: "%",
    gait_index_left_pct: "%",
    gait_index_right_pct: "%",
    step_time_cv_pct: "%",
    cycle_time_cv_pct: "%",
    total_duration_sec: "s",
    total_peaks: ""
};

// Human-readable metric descriptions (copied/extended from researcher view metadata)
const METRIC_INFO = {
    composite_score: "Composite mobility score combining gait indicators into one summary metric.",
    GSI_pct: "Gait Symmetry Index. Lower values indicate more symmetric (healthier) gait.",
    symmetry_ratio: "Left/right gait symmetry. Values near 1.0 indicate balanced gait.",
    step_time_cv_pct: "Step time variability (coefficient of variation). Lower is generally more stable.",
    cycle_time_cv_pct: "Gait cycle time variability. Lower values indicate more consistent timing.",
    cadence_total_steps_min: "Cadence in steps per minute.",
    gait_index_left_pct: "Left gait index score.",
    gait_index_right_pct: "Right gait index score.",
    step_time_mean_sec: "Average step time in seconds.",
    step_time_std_sec: "Standard deviation of step time (seconds).",
    cycle_time_mean_sec: "Average gait cycle time in seconds.",
    cycle_time_std_sec: "Standard deviation of gait cycle time (seconds).",
    IPI_left_mean_sec: "Inter-peak interval (left) mean in seconds.",
    IPI_left_std_sec: "Inter-peak interval (left) standard deviation in seconds.",
    IPI_right_mean_sec: "Inter-peak interval (right) mean in seconds.",
    IPI_right_std_sec: "Inter-peak interval (right) standard deviation in seconds.",
    GA_signed_pct: "Gait acceleration (signed) percentage.",
    total_steps: "Total step count for the session.",
    total_duration_sec: "Total recording duration in seconds.",
    total_peaks: "Total detected gait peaks in the signal.",
    GSI_pct_norm: "Normalized Gait Symmetry Index.",
    symmetry_ratio_norm: "Normalized gait symmetry metric.",
    gait_index_left_pct_norm: "Normalized left gait index.",
    gait_index_right_pct_norm: "Normalized right gait index.",
    step_time_cv_pct_norm: "Normalized step-time variability.",
    cycle_time_cv_pct_norm: "Normalized cycle-time variability.",
    "GSI-TUG": "Gait Symmetry Index averaged across TUG (Timed Up and Go) trials.",
    "GSI-W": "Gait Symmetry Index averaged across walking trials.",
    "GIR-TUG": "Right gait index averaged across TUG trials.",
    "GIL-TUG": "Left gait index averaged across TUG trials.",
    "GIR-W": "Right gait index averaged across walking trials.",
    "GIL-W": "Left gait index averaged across walking trials."
};


function getMetricTooltip(metricKey, fallbackLabel = "") {
    if (metricKey && METRIC_INFO[metricKey]) return METRIC_INFO[metricKey];
    // fallback: convert key to readable label
    if (metricKey) return metricKey.replace(/_/g, ' ');
    return fallbackLabel || metricKey || "Metric details not available.";
}

// Global State
let globalCompositeData = []; 
let activityDataSets = {};
let globalActivityMetricLookup = {};
let hasLoadedGlobalActivityMetricLookup = false;
let selectedPatientId = 1;
let selectedWeek = null;
let selectedActivity = null;
// Weighting state and derived data
let sliderPositions = [25, 50, 75]; // three handles (percents)
let currentWeights = [25, 25, 25, 25];
let derivedCompositeData = []; // globalCompositeData remapped by currentWeights
// Activity colors: SC=red, STS=yellow, TUG=green, W=blue
const ACTIVITY_COLORS = { "SC": "#ef4444", "STS": "#f59e0b", "TUG": "#10b981", "W": "#3b82f6" };
// Composite (aggregated) series color
const COMPOSITE_COLOR = "#7c3aed";

// Toggle: when true, right-side metrics view becomes a bar-chart comparing to mean
let showMetricBarView = false;

const tooltip = d3.select("body").append("div").attr("class", "d3-tooltip").style("opacity", 0);
const scoreColorScale = d3.scaleLinear()
    .domain([0, 50, 80, 100])
    .range(["#ef4444", "#f59e0b", "#10b981", "#059669"]);

function percentileRankFromSortedValues(sortedValues, value) {
    if (!Array.isArray(sortedValues) || !sortedValues.length || !Number.isFinite(value)) return 0;
    if (sortedValues.length === 1) return 1;
    const left = d3.bisectLeft(sortedValues, value);
    const right = d3.bisectRight(sortedValues, value);
    const averageRankZeroBased = (left + right - 1) / 2;
    return averageRankZeroBased / (sortedValues.length - 1);
}

function getTrackedMetricKeys() {
    return Array.from(new Set(Object.values(ACTIVITY_METRICS).flat()));
}

function buildActivityMetricLookup(rows, metricKeys) {
    const lookup = {};
    rows.forEach((row) => {
        const activity = String(row.activity || "").trim().toUpperCase();
        if (!activity) return;
        if (!lookup[activity]) lookup[activity] = {};

        metricKeys.forEach((metricKey) => {
            const numericValue = Number(row[metricKey]);
            if (!Number.isFinite(numericValue)) return;
            if (!lookup[activity][metricKey]) lookup[activity][metricKey] = [];
            lookup[activity][metricKey].push(numericValue);
        });
    });

    Object.keys(lookup).forEach((activity) => {
        Object.keys(lookup[activity]).forEach((metricKey) => {
            lookup[activity][metricKey].sort((a, b) => a - b);
        });
    });

    return lookup;
}

async function ensureGlobalActivityMetricLookup() {
    if (hasLoadedGlobalActivityMetricLookup) return;
    const rows = await d3.csv(ALL_PATIENTS_DATA_PATH);
    globalActivityMetricLookup = buildActivityMetricLookup(rows, getTrackedMetricKeys());
    hasLoadedGlobalActivityMetricLookup = true;
    // Also load means at the same time
    if (!hasLoadedGlobalMeans) {
        globalMeanValuesByActivity = computeMeanValuesByActivity(rows, getTrackedMetricKeys());
        hasLoadedGlobalMeans = true;
    }
}

function getActivityMetricPercentile(activity, metricKey, value) {
    const activityCode = String(activity || "").trim().toUpperCase();
    const globalSortedValues = globalActivityMetricLookup?.[activityCode]?.[metricKey];
    const fallbackSortedValues = (activityDataSets[activityCode] || [])
        .map((row) => Number(row[metricKey]))
        .filter((v) => Number.isFinite(v))
        .sort((a, b) => a - b);
    const sortedValues = (Array.isArray(globalSortedValues) && globalSortedValues.length) ? globalSortedValues : fallbackSortedValues;
    return percentileRankFromSortedValues(sortedValues, Number(value));
}

function formatMetricValueWithUnit(value, unit) {
    if (!Number.isFinite(value)) return "N/A";
    const formatted = value.toFixed(3).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
    if (!unit || unit === '-') return formatted;
    return `${formatted} ${unit}`;
}

function computeMeanValuesByActivity(rows, metricKeys) {
    const byActivity = {};
    rows.forEach(row => {
        const activity = String(row.activity || "").trim().toUpperCase();
        if (!activity) return;
        if (!byActivity[activity]) byActivity[activity] = {};
        
        metricKeys.forEach(metricKey => {
            const val = Number(row[metricKey]);
            if (!Number.isFinite(val)) return;
            if (!byActivity[activity][metricKey]) byActivity[activity][metricKey] = { sum: 0, count: 0 };
            byActivity[activity][metricKey].sum += val;
            byActivity[activity][metricKey].count += 1;
        });
    });
    
    const means = {};
    Object.keys(byActivity).forEach(activity => {
        means[activity] = {};
        Object.keys(byActivity[activity]).forEach(metricKey => {
            const { sum, count } = byActivity[activity][metricKey];
            means[activity][metricKey] = count > 0 ? sum / count : 0;
        });
    });
    return means;
}

let globalMeanValuesByActivity = {};
let hasLoadedGlobalMeans = false;

async function ensureGlobalMeans() {
    if (hasLoadedGlobalMeans) return;
    const rows = await d3.csv(ALL_PATIENTS_DATA_PATH);
    globalMeanValuesByActivity = computeMeanValuesByActivity(rows, getTrackedMetricKeys());
    hasLoadedGlobalMeans = true;
}

/**
 * 1. INITIALIZATION & DIRECTORY SCANNING
 */
async function initPatientPage() {
    await loadSharedHeader();
    await setupPatientSelector();
    await loadUserData(selectedPatientId);
}

async function setupPatientSelector() {
    let userIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; // Fallback
    // Prefer an explicit JSON manifest on static hosts (works on GitHub Pages)
    try {
        const res = await fetch("data/users/users.json");
        if (res.ok) {
            const parsed = await res.json();
            if (Array.isArray(parsed) && parsed.length > 0) userIds = parsed.map(Number);
        } else {
            // fallback: attempt directory scan (some servers expose index listings)
            try {
                const response = await fetch("data/users/");
                if (response.ok) {
                    const text = await response.text();
                    const doc = new DOMParser().parseFromString(text, "text/html");
                    const scannedIds = Array.from(doc.querySelectorAll("a"))
                        .map(link => link.textContent.replace('/', ''))
                        .filter(name => !isNaN(name) && name.length > 0)
                        .map(Number);
                    if (scannedIds.length > 0) userIds = scannedIds;
                }
            } catch (e2) { console.warn("Directory scan failed, using hardcoded IDs."); }
        }
    } catch (e) {
        console.warn("users.json fetch failed, falling back to directory scan or hardcoded IDs.", e);
        try {
            const response = await fetch("data/users/");
            if (response.ok) {
                const text = await response.text();
                const doc = new DOMParser().parseFromString(text, "text/html");
                const scannedIds = Array.from(doc.querySelectorAll("a"))
                    .map(link => link.textContent.replace('/', ''))
                    .filter(name => !isNaN(name) && name.length > 0)
                    .map(Number);
                if (scannedIds.length > 0) userIds = scannedIds;
            }
        } catch (e2) { console.warn("Directory scan failed, using hardcoded IDs."); }
    }

    const select = d3.select("#patient-select");
    select.selectAll("option").data(userIds).enter().append("option")
        .text(d => `Patient ${d}`).attr("value", d => d);
    
    select.on("change", async function() {
        selectedPatientId = +this.value;
        await loadUserData(selectedPatientId);
    });
}

/**
 * 2. DATA LOADING (Optimized Parallel Loading)
 */
async function loadUserData(userId) {
    const basePath = `data/users/${userId}/${userId}`;
    try {
        try {
            await ensureGlobalActivityMetricLookup();
        } catch (lookupError) {
            console.warn("Global percentile lookup unavailable; using current patient baseline.", lookupError);
        }

        // Load the main trend file
        globalCompositeData = await d3.csv(`${basePath}_composite.csv`, d => ({
            ...d, week: +d.week, composite_score_overall: +d.composite_score_overall
        }));

        // Load all 4 activity files at once
        const results = await Promise.all(ACTIVITIES.map(act => d3.csv(`${basePath}_${act}.csv`, d => {
            const parsed = { ...d };
            Object.keys(d).forEach(key => { if (!isNaN(parseFloat(d[key]))) parsed[key] = +d[key]; });
            return parsed;
        })));

        ACTIVITIES.forEach((act, i) => { activityDataSets[act] = results[i]; });

        selectedWeek = d3.max(globalCompositeData, d => d.week);
        // compute initial derived composite using default weights
        computeDerivedComposite();
        setupCompositeWeightingUI();
        updatePatientView();
    } catch (err) { console.error("Error loading user data:", err); }
}

/**
 * 3. CORE VIEW UPDATES
 */
function updatePatientView(options = {}) {
    const skipSecondRow = Boolean(options.skipSecondRow);
    const weekData = derivedCompositeData.find(d => d.week === selectedWeek) || globalCompositeData.find(d => d.week === selectedWeek);
    if (!weekData) return;
    d3.select("#patient-name-header").text(`Patient ${selectedPatientId}`);
    updateSummaryHeader(weekData);
    renderLineChart(derivedCompositeData.length ? derivedCompositeData : globalCompositeData);
    if (!skipSecondRow) {
        renderActivityBars(selectedWeek);
        renderRadarCharts();
    }
}

function updateSummaryHeader(data) {
    const score = data.composite_score_overall;
    const color = scoreColorScale(score);
    d3.select("#week-display").text(`Week ${data.week}`);
    d3.select("#score-val-big").text(score.toFixed(1));
    // set progress width but keep its color neutral; highlight the whole summary box instead
    d3.select("#health-bar").style("width", `${score}%`).style("background-color", "rgba(255,255,255,0.9)");

    // apply background highlight to the summary section and ensure readable text
    const summary = d3.select('.summary-section');
    summary.style('background-color', color).style('color', '#ffffff').style('border-color', color);
}

/**
 * 4. WEEKLY ACTIVITY BARS
 */
function renderActivityBars(week, target = "#activity-bars-container") {
    const container = d3.select(target);
    container.selectAll("*").remove();

    ACTIVITIES.forEach(act => {
        const data = activityDataSets[act].find(d => d.week === week);
        const score = data ? data.composite_score : 0;
        const color = scoreColorScale(score);

        const item = container.append("div").style("display", "flex").style("flex-direction", "column").style("gap", "8px").style("margin-bottom", "6px");

        // label above the bar (color dot + title)
        const labelTop = item.append("div").style("display","flex").style("align-items","center").style("gap","8px").style("justify-content","flex-start");
        labelTop.append("div").style("width","12px").style("height","12px").style("border-radius","50%").style("background", ACTIVITY_COLORS[act]);
        labelTop.append("div").style("font-size","14px").style("font-weight","600").text(ACTIVITY_NAMES[act]);

        // bar row: bar + numeric value
        const barRow = item.append("div").style("display","flex").style("align-items","center").style("gap","12px");
        const barBg = barRow.append("div").style("flex", "1").style("background", "#f1f5f9").style("height", "12px").style("border-radius", "6px").style("overflow", "hidden");
        barBg.append("div").style("width", "0%").style("height", "100%").style("background", color)
            .transition().duration(800).style("width", `${score}%`);
        barRow.append("div").style("width", "40px").style("text-align", "right").style("font-weight", "700").text(Math.round(score));
    });
}

/* ------------------ Composite Weighting UI & Logic ------------------ */
function setupCompositeWeightingUI() {
    try {
        const h1 = document.getElementById('handle-1');
        const h2 = document.getElementById('handle-2');
        const h3 = document.getElementById('handle-3');
        const t1 = document.getElementById('thumb-1');
        const t2 = document.getElementById('thumb-2');
        const t3 = document.getElementById('thumb-3');
        const segs = [document.getElementById('seg-0'), document.getElementById('seg-1'), document.getElementById('seg-2'), document.getElementById('seg-3')];
        const legend = document.getElementById('weight-legend');

        function updateFromPositions() {
            const p1 = +h1.value; const p2 = +h2.value; const p3 = +h3.value;
            // enforce ordering and 1-unit edge spacing
            if (p1 >= p2) h1.value = p2 - 1;
            if (p1 < 1) h1.value = 1;
            if (p2 <= p1) h2.value = +h1.value + 1;
            if (p2 >= p3) h2.value = p3 - 1;
            if (p3 > 99) h3.value = 99;
            if (p3 <= p2) h3.value = +h2.value + 1;

            sliderPositions = [+h1.value, +h2.value, +h3.value];
            // raw segments based on handle positions (ensures visual segments match handle locations)
            const raw = [sliderPositions[0], sliderPositions[1] - sliderPositions[0], sliderPositions[2] - sliderPositions[1], 100 - sliderPositions[2]];
            // subtract 1 reserved unit from each segment so 0% becomes achievable for weights
            const effective = raw.map(v => Math.max(0, v - 1));
            const sumEff = effective.reduce((s, x) => s + x, 0);
            if (sumEff > 0) {
                currentWeights = effective.map(v => (v / sumEff) * 100);
            } else {
                currentWeights = [25, 25, 25, 25];
            }

            // update segments width and colors using raw percentages so handles align visually
            segs.forEach((s, i) => { s.style.width = raw[i] + '%'; s.style.background = ACTIVITY_COLORS[ACTIVITIES[i]]; });

            // update thumbs positions
            t1.style.left = `${sliderPositions[0]}%`;
            t2.style.left = `${sliderPositions[1]}%`;
            t3.style.left = `${sliderPositions[2]}%`;

            // update legend: emit compact tiles (activity name in colored box, percent below)
            legend.innerHTML = '';
            ACTIVITIES.forEach((act, i) => {
                const item = document.createElement('div'); item.className = 'legend-item';
                const box = document.createElement('div'); box.className = 'legend-box'; box.style.background = ACTIVITY_COLORS[act]; box.textContent = ACTIVITY_NAMES[act];
                const weight = document.createElement('div'); weight.className = 'legend-weight'; weight.textContent = `${Math.round(currentWeights[i])}%`;
                item.appendChild(box);
                item.appendChild(weight);
                legend.appendChild(item);
            });

            // recompute derived composite and update only top-row views
            computeDerivedComposite();
            updatePatientView({ skipSecondRow: true });
        }

        // keyboard/input support (for accessibility)
        [h1, h2, h3].forEach(h => h.addEventListener('input', () => updateFromPositions()));

        // Add pointer drag support on visible thumbs so each handle is independently draggable
        let draggingIndex = -1;
        const track = document.getElementById('weight-track');
        function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

        function posToPercent(clientX) {
            const rect = track.getBoundingClientRect();
            const x = clamp(clientX - rect.left, 0, rect.width);
            return (x / rect.width) * 100;
        }

        function startDrag(i, e) {
            e.preventDefault();
            draggingIndex = i;
            document.body.style.userSelect = 'none';
        }

        let rafPending = false;
        function onMove(e) {
            if (draggingIndex === -1) return;
            const pct = posToPercent(e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0].clientX));
            // determine neighbor bounds
            const leftBound = draggingIndex === 0 ? 1 : sliderPositions[draggingIndex - 1] + 1;
            const rightBound = draggingIndex === 2 ? 99 : sliderPositions[draggingIndex + 1] - 1;
            const clamped = clamp(pct, leftBound, rightBound);
            // update underlying input value (fast)
            if (draggingIndex === 0) h1.value = Math.round(clamped);
            if (draggingIndex === 1) h2.value = Math.round(clamped);
            if (draggingIndex === 2) h3.value = Math.round(clamped);
            // throttle heavy updates to animation frames to avoid layout thrashing
            if (!rafPending) {
                rafPending = true;
                requestAnimationFrame(() => { updateFromPositions(); rafPending = false; });
            }
        }

        function endDrag() { draggingIndex = -1; document.body.style.userSelect = ''; }

        [t1, t2, t3].forEach((t, i) => {
            t.addEventListener('pointerdown', (e) => startDrag(i, e));
        });
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', endDrag);

        // reset button handler
        const resetBtn = document.getElementById('reset-weights');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                h1.value = 25; h2.value = 50; h3.value = 75;
                updateFromPositions();
            });
        }

        // initial update
        updateFromPositions();
    } catch (e) { console.warn('Composite weighting UI setup failed', e); }
}

function computeDerivedComposite() {
    if (!globalCompositeData || !globalCompositeData.length) return;
    derivedCompositeData = globalCompositeData.map(row => {
        const week = row.week;
        const scores = ACTIVITIES.map(act => {
            const r = (activityDataSets[act] || []).find(d => d.week === week);
            return r ? (+r.composite_score || 0) : 0;
        });
        const combined = scores.reduce((acc, s, i) => acc + (s * (currentWeights[i] / 100)), 0);
        return { ...row, composite_score_overall: combined };
    });
}

/**
 * 5. CHARTS: LINE & RADAR
 */
function renderLineChart(data, target = "#line-chart", defaultW = 700, h = 300) {
    const container = d3.select(target);
    container.selectAll("*").remove();

    // determine width from container so chart spans the box responsively
    const parentNode = container.node();
    const availableW = parentNode ? Math.max(parentNode.clientWidth, 300) : defaultW;
    const margin = {top: 20, right: 30, bottom: 40, left: 50}, width = availableW - margin.left - margin.right, height = h - margin.top - margin.bottom;

    const svg = container.append("svg")
        .attr("width", availableW)
        .attr("height", h)
        .attr("viewBox", `0 0 ${availableW} ${h}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain(d3.extent(data, d => d.week)).range([0, width]);
    // Dynamic vertical scale: compute min/max of the composite scores and add a small padding
    const vals = data.map(d => +d.composite_score_overall).filter(v => isFinite(v));
    let yMin = d3.min(vals);
    let yMax = d3.max(vals);
    if (!isFinite(yMin) || !isFinite(yMax)) { yMin = 0; yMax = 100; }
    if (yMax === yMin) { yMin = yMin - 1; yMax = yMax + 1; }
    const pad = (yMax - yMin) * 0.1; // 10% padding
    const y = d3.scaleLinear().domain([yMin - pad, yMax + pad]).range([height, 0]).nice();

    // create axes and style ticks/lines for better readability
    const gx = svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(Math.max(data.length, 4)));
    gx.selectAll('text').style('font-size', '14px').style('fill', '#475569');
    gx.selectAll('line').style('stroke', '#e2e8f0');
    gx.selectAll('path').style('stroke', '#94a3b8');

    const gy = svg.append("g").call(d3.axisLeft(y));
    gy.selectAll('text').style('font-size', '14px').style('fill', '#475569');
    gy.selectAll('line').style('stroke', '#e2e8f0');
    gy.selectAll('path').style('stroke', '#94a3b8');

    // Axis labels (slightly larger for readability)
    svg.append('text')
        .attr('class', 'axis-label x-axis-label')
        .attr('text-anchor', 'middle')
        .attr('x', width / 2)
        .attr('y', height + margin.bottom - 8)
        .attr('fill', '#475569')
        .style('font-size', '15px')
        .style('font-weight', 600)
        .text('Week');

    svg.append('text')
        .attr('class', 'axis-label y-axis-label')
        .attr('text-anchor', 'middle')
        .attr('transform', `rotate(-90)`)
        .attr('x', -height / 2)
        .attr('y', -margin.left + 14)
        .attr('fill', '#475569')
        .style('font-size', '15px')
        .style('font-weight', 600)
        .text('Overall Composite Score');

    const line = d3.line().x(d => x(d.week)).y(d => y(d.composite_score_overall));
    svg.append("path").datum(data).attr("fill", "none").attr("stroke", COMPOSITE_COLOR).attr("stroke-width", 2.5).attr("d", line);

    svg.selectAll("circle").data(data).enter().append("circle")
        .attr("cx", d => x(d.week)).attr("cy", d => y(d.composite_score_overall))
        .attr("r", d => (d.week === selectedWeek ? 8 : 5))
        .attr("fill", d => (d.week === selectedWeek ? '#ffffff' : COMPOSITE_COLOR))
        .attr('stroke', d => (d.week === selectedWeek ? COMPOSITE_COLOR : 'none'))
        .attr('stroke-width', d => (d.week === selectedWeek ? 2 : 0))
        .style('cursor','pointer')
        .on("click", (e, d) => { selectedWeek = d.week; updatePatientView(); })
        .on('mouseover', (e, d) => {
            // use consistent light tooltip style
            tooltip.style('position', 'absolute').style('pointer-events', 'none')
                .style('background', '#ffffff').style('color', '#0f172a').style('padding', '6px 8px')
                .style('border', '1px solid #e2e8f0').style('border-radius', '6px').style('font-size', '13px').style('min-width', '60px');
            const wk = d && d.week ? d.week : '?';
            const score = d && isFinite(d.composite_score_overall) ? Math.round(d.composite_score_overall) : 0;
            tooltip.style('opacity', 1).html(`<strong>Week ${wk}</strong><br/>${score}`)
                .style('left', (e.pageX + 10) + 'px').style('top', (e.pageY + 10) + 'px');
        })
        .on('mousemove', (e) => {
            tooltip.style('left', (e.pageX + 10) + 'px').style('top', (e.pageY + 10) + 'px');
        })
        .on('mouseout', () => { tooltip.style('opacity', 0); });
}

function renderRadarCharts(mode = 'both', isEnlarged = false) {
    const targetAct = isEnlarged ? "#modal-radar-act" : "#radar-activities";
    const targetMet = isEnlarged ? "#modal-radar-met" : "#radar-metrics";
    const size = isEnlarged ? 400 : 220;

    const activityScores = ACTIVITIES.map(act => {
        const entry = activityDataSets[act].find(d => d.week === selectedWeek);
        const actualValue = entry ? entry.composite_score : 0;
        // Display raw composite score (0-100 scale)
        return { axis: act, displayName: ACTIVITY_NAMES[act] || act, value: actualValue, actualValue };
    });
    
    // Compute mean activity scores from all patients
    const meanActivityScores = ACTIVITIES.map(act => {
        const meanVal = globalMeanValuesByActivity[act]?.composite_score || 0;
        // Display raw mean composite score (0-100 scale)
        return { axis: act, displayName: ACTIVITY_NAMES[act] || act, value: meanVal, actualValue: meanVal, isMean: true };
    });

    // helper to compute metric values and draw metric radar for a given activity
    function drawMetricRadarFor(activity) {
        const container = d3.select(targetMet);
        container.selectAll("*").remove();

        // update title (if present) to reflect selected activity or default
        try {
            const titleElId = isEnlarged ? 'modal-title' : 'radar-metrics-title';
            const titleEl = document.getElementById(titleElId);
            if (titleEl) titleEl.textContent = activity ? `${ACTIVITY_NAMES[activity] || activity} Performance` : 'Activity Performance';
        } catch (e) { /* ignore in non-browser or missing DOM */ }

        if (!activity) {
            container.append('div')
                .attr('class', 'radar-placeholder')
                .style('height', size + 'px')
                .style('display', 'flex')
                .style('align-items', 'center')
                .style('justify-content', 'center')
                .style('color', '#64748b')
                .style('font-size', '15px')
                .style('padding', '10px')
                .text('Click on an activity on the left to view its performance metrices');
            return;
        }

        const actWeekData = activityDataSets[activity]?.find(d => d.week === selectedWeek);
        const metricValues = (ACTIVITY_METRICS[activity] || []).filter(k => k !== 'composite_score').map(rawMetricKey => {
            const axisRaw = rawMetricKey.replace(/_pct/g, '').replace(/_/g, ' ').trim();
            const axis = axisRaw.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            const actualValue = (function(){
                const rawActual = actWeekData ? actWeekData[rawMetricKey] : 0;
                const n = Number(rawActual);
                return isFinite(n) ? n : 0;
            })();
            const normalizedValue = (function() {
                if (!actWeekData) return 0;
                const percentile = getActivityMetricPercentile(activity, rawMetricKey, actWeekData[rawMetricKey]);
                const n = Number(percentile);
                return isFinite(n) ? n : 0;
            })();
            return {
                axis,
                value: normalizedValue * 100,
                normalizedValue,
                actualValue,
                rawMetricKey,
                unit: METRIC_UNITS[rawMetricKey] || ''
            };
        });
        
        // Compute mean metric values for this activity
        const meanMetricValues = (ACTIVITY_METRICS[activity] || []).filter(k => k !== 'composite_score').map(rawMetricKey => {
            const axisRaw = rawMetricKey.replace(/_pct/g, '').replace(/_/g, ' ').trim();
            const axis = axisRaw.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            const actualValue = globalMeanValuesByActivity[activity]?.[rawMetricKey] || 0;
            const normalizedValue = (function() {
                if (!actualValue) return 0;
                const percentile = getActivityMetricPercentile(activity, rawMetricKey, actualValue);
                const n = Number(percentile);
                return isFinite(n) ? n : 0;
            })();
            return {
                axis,
                value: normalizedValue * 100,
                normalizedValue,
                actualValue,
                rawMetricKey,
                unit: METRIC_UNITS[rawMetricKey] || '',
                isMean: true
            };
        });
        // ensure toggle exists
        ensureMetricsViewToggle();

        if (showMetricBarView) {
            drawMetricsBarChart(targetMet, metricValues, meanMetricValues, size, {
                showMetricTooltipDetails: true
            });
        } else {
            drawRadar(targetMet, [{ values: metricValues }], null, size, {
                showMetricTooltipDetails: true,
                normalizationLabel: 'Percentile',
                meanData: meanMetricValues,
                meanColor: '#94a3b8',
                meanPointColorMode: 'activity'
            });
        }
    }

    // draw activity breakdown radar (if requested)
    if (mode === 'both' || mode === 'act') {
        const actOnClick = (d) => {
            selectedActivity = d.axis;
            if (isEnlarged && mode === 'act') {
                // in enlarged activities view, clicking an activity will switch modal to metrics for that activity
                try { document.getElementById('modal-title').textContent = `${ACTIVITY_NAMES[selectedActivity] || selectedActivity} Performance`; } catch (e) {}
                renderRadarCharts('met', true);
            } else {
                drawMetricRadarFor(selectedActivity);
            }
        };
        drawRadar(targetAct, [{ values: activityScores }], actOnClick, size, {
            meanData: meanActivityScores,
            showMetricTooltipDetails: true,
            meanColor: '#94a3b8',
            meanPointColor: '#94a3b8',
            meanPointColorMode: 'fixed',
            // force the patient/activity polygon on the left to use composite/purple fill
            patientFillColor: COMPOSITE_COLOR
        });
    }

    // draw metric radar (if requested)
    if (mode === 'both' || mode === 'met') {
        drawMetricRadarFor(selectedActivity);
    }
}

function wrapSvgText(selection, maxWidth, lineHeightEm = 1.05, maxLines = 3) {
    selection.each(function() {
        const text = d3.select(this);
        const words = String(text.text() || '').trim().split(/\s+/).filter(Boolean);
        const x = text.attr('x');
        const y = text.attr('y');
        if (!words.length) return;

        text.text(null);
        let line = [];
        let lineNumber = 0;
        let tspan = text.append('tspan').attr('x', x).attr('y', y).attr('dy', '0em');

        for (let index = 0; index < words.length; index += 1) {
            line.push(words[index]);
            tspan.text(line.join(' '));

            if (tspan.node().getComputedTextLength() > maxWidth && line.length > 1) {
                line.pop();
                tspan.text(line.join(' '));
                line = [words[index]];
                lineNumber += 1;

                if (lineNumber >= maxLines) {
                    const previous = text.select(`tspan:nth-child(${maxLines})`);
                    if (!previous.empty()) {
                        const truncated = previous.text().replace(/\s+$/, '');
                        previous.text(`${truncated}…`);
                    }
                    break;
                }

                tspan = text
                    .append('tspan')
                    .attr('x', x)
                    .attr('y', y)
                    .attr('dy', `${lineNumber * lineHeightEm}em`)
                    .text(words[index]);
            }
        }
    });
}

// Add a small toggle next to metrics title to switch to bar view
function ensureMetricsViewToggle() {
    try {
        const attach = (titleId) => {
            const titleEl = document.getElementById(titleId);
            if (!titleEl) return;
            if (document.getElementById('metrics-bar-toggle-' + titleId)) return;

            const wrapper = document.createElement('div');
            wrapper.style.display = 'inline-flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.gap = '8px';
            wrapper.style.marginLeft = '12px';

            const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'metrics-bar-toggle-' + titleId; cb.checked = showMetricBarView;
            const lbl = document.createElement('label'); lbl.htmlFor = cb.id; lbl.textContent = 'Bar view'; lbl.style.fontSize = '13px'; lbl.style.color = '#475569';
            cb.addEventListener('change', (e) => { showMetricBarView = !!e.target.checked; try { renderRadarCharts(); } catch (err) {} });

            wrapper.appendChild(cb); wrapper.appendChild(lbl);
            titleEl.appendChild(wrapper);
        };
        attach('radar-metrics-title');
        attach('modal-radar-metrics-title');
    } catch (e) { /* ignore */ }
}

// Draw horizontal bars comparing patient metric actual values to mean values
function drawMetricsBarChart(containerId, metricValues, meanMetricValues, size, options = {}) {
    const container = d3.select(containerId);
    container.selectAll('*').remove();
    // Merge values by rawMetricKey (or axis text) to compute percent change
    const rows = metricValues.map((m, i) => {
        const mean = meanMetricValues[i] || { actualValue: 0, unit: m.unit };
        const meanVal = Number(mean.actualValue) || 0;
        const actualVal = Number(m.actualValue) || 0;
        let pctChange = null;
        if (meanVal === 0) pctChange = NaN; else pctChange = ((actualVal - meanVal) / Math.abs(meanVal)) * 100;
        return { axis: m.axis || m.rawMetricKey || ('Metric ' + i), rawMetricKey: m.rawMetricKey, unit: m.unit || mean.unit || '', actual: actualVal, mean: meanVal, pct: pctChange };
    });

    // compute scale reference for width based on max absolute percent change (ignore NaN)
    const absPcts = rows.map(r => Number.isFinite(r.pct) ? Math.abs(r.pct) : 0);
    const maxAbsPct = Math.max(1, d3.max(absPcts));

    // container: center contents
    const outer = container.append('div').style('display','flex').style('flex-direction','column').style('align-items','center').style('justify-content','center').style('gap','14px').style('padding','8px').style('width','100%');

    rows.forEach(r => {
        const block = outer.append('div').style('display','flex').style('flex-direction','column').style('align-items','center').style('width','100%');
        // Title above bar centered (with tooltip handlers)
        const titleSel = block.append('div').text(r.axis).style('font-weight','700').style('color','#334155').style('margin-bottom','6px').style('text-align','center');
        titleSel.on('mouseover', (e) => {
            const desc = getMetricTooltip(r.rawMetricKey, r.axis);
            const actualFormatted = Number.isFinite(r.actual) ? formatMetricValueWithUnit(r.actual, r.unit) : 'N/A';
            const meanFormatted = Number.isFinite(r.mean) ? formatMetricValueWithUnit(r.mean, r.unit) : 'N/A';
            const pctText = Number.isFinite(r.pct) ? ((r.pct >= 0 ? '+' : '') + r.pct.toFixed(1) + '%') : 'N/A';
            const html = `<strong>${r.axis}</strong><br/><div style="color:#475569;font-size:12px;margin-top:6px;margin-bottom:6px;">${desc}</div><div>Value: ${actualFormatted}</div><div>Mean: ${meanFormatted}</div><div>Change: ${pctText}</div>`;
            tooltip.style('position', 'absolute').style('pointer-events', 'none').style('background', '#ffffff').style('color', '#0f172a').style('padding', '6px 8px').style('border', '1px solid #e2e8f0').style('border-radius', '6px').style('font-size', '13px').style('min-width','120px');
            tooltip.html(html).style('opacity', 1).style('left', (e.pageX + 10) + 'px').style('top', (e.pageY + 10) + 'px');
        }).on('mousemove', (e) => {
            tooltip.style('left', (e.pageX + 10) + 'px').style('top', (e.pageY + 10) + 'px');
        }).on('mouseout', () => { tooltip.style('opacity', 0); });

        const row = block.append('div').style('display','flex').style('align-items','center').style('gap','12px').style('width','100%');
        // left spacer for values
        row.append('div').style('flex','0 0 120px').style('text-align','right').html(`<div style="font-weight:700;color:#0f172a">${Number.isFinite(r.actual) ? formatMetricValueWithUnit(r.actual, r.unit) : 'N/A'}</div>`);

        // bar track centered with zero at middle
        const track = row.append('div')
            .style('flex','1')
            .style('background','#f8fafc')
            .style('height','26px')
            .style('border-radius','8px')
            .style('position','relative')
            .style('overflow','visible')
            .style('display','flex')
            .style('align-items','center')
            .style('justify-content','center')
            .style('min-width','260px')
            .style('border','1px solid #e6eef6');

        // center marker (zero) with label
        track.append('div')
            .style('position','absolute')
            .style('left','50%')
            .style('top','3px')
            .style('bottom','3px')
            .style('width','3px')
            .style('background','#cbd5e1')
            .style('transform','translateX(-50%)');

        // (removed center label '0%' to avoid overlapping titles)

        const pct = Number.isFinite(r.pct) ? r.pct : 0;
        const halfWidthPct = Math.min(50, (Math.abs(pct) / Math.max(1, maxAbsPct)) * 50); // mapped to half-track
        const minVisiblePct = 2; // ensure tiny bars are visible

        if (Number.isFinite(r.pct) && r.pct > 0) {
            // positive: green bar from center to right
            track.append('div')
                .style('position','absolute')
                .style('left','50%')
                .style('height','16px')
                .style('top','5px')
                .style('bottom','5px')
                .style('width', Math.max(minVisiblePct, halfWidthPct) + '%')
                .style('background','#10b981')
                .style('border-radius','0 8px 8px 0')
                .style('box-shadow','0 1px 2px rgba(0,0,0,0.04)');
        } else if (Number.isFinite(r.pct) && r.pct < 0) {
            // negative: red bar from center to left
            track.append('div')
                .style('position','absolute')
                .style('right','50%')
                .style('height','16px')
                .style('top','5px')
                .style('bottom','5px')
                .style('width', Math.max(minVisiblePct, halfWidthPct) + '%')
                .style('background','#ef4444')
                .style('border-radius','8px 0 0 8px')
                .style('box-shadow','0 1px 2px rgba(0,0,0,0.04)');
        } else {
            // neutral/undefined: small grey marker at center
            track.append('div')
                .style('position','absolute')
                .style('left','50%')
                .style('height','8px')
                .style('top','9px')
                .style('width','8px')
                .style('background','#94a3b8')
                .style('border-radius','50%')
                .style('transform','translateX(-50%)');
        }

        // percent badge on right side
        row.append('div').style('flex','0 0 100px').style('text-align','left').html(`<div style="font-weight:700;color:${Number.isFinite(r.pct) ? (r.pct>=0? '#065f46':'#7f1d1d') : '#475569'}">${Number.isFinite(r.pct) ? ((r.pct>=0?'+':'') + r.pct.toFixed(1) + '%') : 'N/A'}</div>`);
    });
}

function drawRadar(containerId, data, onClick, size, options = {}) {
    const isLargeRadar = size >= 400;
    const labelDistance = isLargeRadar ? 120 : 140;
    const labelWrapWidth = isLargeRadar ? 156 : 82;
    // Increase margin to accommodate legend below
    const bottomMarginExtra = options.meanData ? (isLargeRadar ? 66 : 36) : 0;
    const cfg = { w: size, h: size, margin: (isLargeRadar ? 122 : 62) + bottomMarginExtra, levels: 4, maxValue: 100 };
    const container = d3.select(containerId);
    container.selectAll("*").remove();
    container.style("overflow", "visible");

    const radius = size/2, angleSlice = Math.PI * 2 / data[0].values.length;
    const rScale = d3.scaleLinear().range([0, radius]).domain([0, cfg.maxValue]);

    const svg = container.append("svg").attr("width", size + cfg.margin*2).attr("height", size + cfg.margin*2)
        .style("overflow", "visible")
        .append("g").attr("transform", `translate(${radius + cfg.margin},${radius + cfg.margin})`);

    // Levels
    for(let j=0; j<cfg.levels; j++) {
        const r = radius * ((j+1)/cfg.levels);
        svg.append("circle").attr("r", r).attr("fill", "none").attr("stroke", "#cbd5e1").attr("stroke-dasharray", "3,3");
        
        // Scale labels (top of the circle)
        const levelValue = Math.round(cfg.maxValue * ((j + 1) / cfg.levels));
        svg.append("text")
            .attr("class", "radar-scale-label")
            .attr("text-anchor", "middle")
            .attr("x", 0)
            .attr("y", -r)
            .attr("dy", "-0.25em")
            .style('font-size', '12px')
            .style('fill', '#475569')
            .text(levelValue);
    }

    // Axes & Labels
    const axis = svg.selectAll(".axis").data(data[0].values).enter().append("g");
    const axisLabels = axis.append("text").attr("text-anchor", "middle")
        .attr("x", (d, i) => rScale(labelDistance) * Math.cos(angleSlice*i - Math.PI/2))
        .attr("y", (d, i) => rScale(labelDistance) * Math.sin(angleSlice*i - Math.PI/2))
        .text(d => d.displayName || d.axis).style("font-size", "15px").style('font-weight', 600).style("cursor", onClick ? "pointer" : "help")
        .on("click", onClick ? (e, d) => onClick({axis: d.axis}) : null);
    wrapSvgText(axisLabels, labelWrapWidth, 1.05, 3);

    // Polygon with enter transition
    const radarLine = d3.lineRadial().radius(d => rScale(d.value)).angle((d, i) => i * angleSlice).curve(d3.curveLinearClosed);
    const meanColor = options.meanColor || '#94a3b8';
    const resolveMeanPointColor = (d) => {
        if (options.meanPointColorMode === 'activity' && ACTIVITY_COLORS[d.axis]) return ACTIVITY_COLORS[d.axis];
        if (options.meanPointColor) return options.meanPointColor;
        return meanColor;
    };
    // choose color: allow explicit override via options.patientFillColor, otherwise
    // if axes map to activities use their color, otherwise use selectedActivity color
    let polygonColor = (data[0].values.every(v => ACTIVITY_COLORS[v.axis])) ? (ACTIVITY_COLORS[data[0].values[0].axis] || COMPOSITE_COLOR) : (ACTIVITY_COLORS[selectedActivity] || COMPOSITE_COLOR);
    if (options.patientFillColor) polygonColor = options.patientFillColor;

    // Draw mean polygon layer first so patient layer stays on top
    if (options.meanData && Array.isArray(options.meanData) && options.meanData.length) {
        const meanFinalVals = options.meanData.map(v => ({ ...v }));
        const meanStartVals = meanFinalVals.map(v => ({ ...v, value: 0 }));
        const meanPoly = svg.append('path').datum(meanStartVals)
            .attr('d', radarLine)
            .attr('fill', meanColor)
            .attr('fill-opacity', 0.14)
            .attr('stroke', meanColor)
            .attr('stroke-width', 1.5);

        meanPoly.transition().duration(800).attrTween('d', function(d) {
            const a = d.map(v => ({ axis: v.axis, value: v.value }));
            const b = meanFinalVals;
            return function(t) {
                const inter = a.map((v, i) => ({ axis: v.axis, value: v.value * (1 - t) + b[i].value * t }));
                return radarLine(inter);
            };
        }).on('end', () => { meanPoly.datum(meanFinalVals); });
    }

    // Start polygon at zero radius and tween to final values for a smooth animation
    const finalVals = data[0].values.map(v => ({ ...v }));
    const startVals = finalVals.map(v => ({ ...v, value: 0 }));
    const poly = svg.append("path").datum(startVals)
        .attr("d", radarLine)
        .attr("fill", polygonColor).attr("fill-opacity", 0.25).attr("stroke", polygonColor).attr("stroke-width", 2);

    poly.transition().duration(800).attrTween('d', function(d) {
        const a = d.map(v => ({ axis: v.axis, value: v.value }));
        const b = finalVals;
        return function(t) {
            const inter = a.map((v, i) => ({ axis: v.axis, value: v.value * (1 - t) + b[i].value * t }));
            return radarLine(inter);
        };
    }).on('end', () => { poly.datum(finalVals); });

    // Points (drawn per-vertex) with tooltip and activity-color mapping; animate from center out
    try {
        // ensure tooltip has sensible inline styles if stylesheet is missing
        tooltip.style("position", "absolute").style("pointer-events", "none").style("background", "#ffffff").style("color", "#0f172a").style("padding", "6px 8px").style("border", "1px solid #e2e8f0").style("border-radius", "6px").style("font-size", "13px").style("min-width","36px");

        const points = svg.selectAll('.radar-point').data(finalVals);

        // enter
        const enterPts = points.enter().append('circle')
            .attr('class', 'radar-point')
            .attr('r', 0)
            .attr('cx', 0)
            .attr('cy', 0)
            .attr('fill', (d) => ACTIVITY_COLORS[d.axis] || polygonColor)
            .style('cursor', onClick ? 'pointer' : 'default');

        // transition to final positions
        enterPts.transition().duration(800).attr('r', 5)
            .attr('cx', (d, i) => rScale(d.value) * Math.cos(angleSlice * i - Math.PI/2))
            .attr('cy', (d, i) => rScale(d.value) * Math.sin(angleSlice * i - Math.PI/2));

        // update existing points (if any) to new positions
        points.transition().duration(800)
            .attr('r', 5)
            .attr('cx', (d, i) => rScale(d.value) * Math.cos(angleSlice * i - Math.PI/2))
            .attr('cy', (d, i) => rScale(d.value) * Math.sin(angleSlice * i - Math.PI/2))
            .attr('fill', (d) => ACTIVITY_COLORS[d.axis] || polygonColor);

        const showRadarTooltip = (e, d, isMean = false) => {
            const code = d && d.axis ? d.axis : 'Value';
            const label = ACTIVITY_NAMES[code] || code;
            const hasMetricDetails = options.showMetricTooltipDetails && d && Object.prototype.hasOwnProperty.call(d, 'normalizedValue');
            let tooltipHtml = '<strong>' + label + '</strong>';
            // If metric descriptions are available, show them first for metric radars
            if (options.showMetricTooltipDetails && d && d.rawMetricKey) {
                const desc = getMetricTooltip(d.rawMetricKey, label);
                tooltipHtml += '<br/><div style="color:#475569;font-size:12px;margin-top:6px;margin-bottom:6px;">' + desc + '</div>';
            }
            
            if (hasMetricDetails) {
                // For metric charts: always show both patient and mean data
                if (isMean) {
                    // Hovering mean point: find corresponding patient data
                    const patientData = finalVals.find(v => v.rawMetricKey === d.rawMetricKey);
                    if (patientData) {
                        const patientFormatted = formatMetricValueWithUnit(patientData.actualValue, patientData.unit);
                        const patientPct = Math.round((patientData.normalizedValue || 0) * 1000) / 10;
                        const normalizationLabel = options.normalizationLabel || 'Normalized';
                        tooltipHtml += '<br/>Value: ' + patientFormatted;
                        tooltipHtml += '<br/>' + normalizationLabel + ': ' + patientPct + '%';
                    }
                    // Show mean data
                    const meanFormatted = formatMetricValueWithUnit(d.actualValue, d.unit);
                    tooltipHtml += '<br/>Mean: ' + meanFormatted;
                } else {
                    // Hovering patient point or axis: show patient data first
                    const actualFormatted = formatMetricValueWithUnit(d.actualValue, d.unit);
                    const normalizedPct = Math.round((d.normalizedValue || 0) * 1000) / 10;
                    const normalizationLabel = options.normalizationLabel || 'Normalized';
                    tooltipHtml += '<br/>Value: ' + actualFormatted;
                    tooltipHtml += '<br/>' + normalizationLabel + ': ' + normalizedPct + '%';
                    
                    // Show mean value if available
                    if (options.meanData && d.rawMetricKey) {
                        const meanData = options.meanData.find(m => m.rawMetricKey === d.rawMetricKey);
                        if (meanData && meanData.actualValue !== undefined && Number.isFinite(meanData.actualValue)) {
                            const meanFormatted = formatMetricValueWithUnit(meanData.actualValue, d.unit);
                            tooltipHtml += '<br/>Mean: ' + meanFormatted;
                        }
                    }
                }
            } else {
                // For activity charts: always show both patient and mean data
                if (isMean) {
                    // Hovering mean point: find corresponding patient data
                    const patientData = finalVals.find(v => v.axis === d.axis);
                    if (patientData && patientData.value !== undefined && Number.isFinite(patientData.value)) {
                        const patientVal = Math.round(patientData.value);
                        tooltipHtml += '<br/>Patient: ' + patientVal;
                    }
                    // Show mean data
                    const meanVal = Math.round(d.value);
                    tooltipHtml += '<br/>Mean: ' + meanVal;
                } else {
                    // Hovering patient point or axis: show patient data first
                    const val = d && isFinite(d.value) ? Math.round(d.value) : 0;
                    tooltipHtml += '<br/>Patient: ' + val;
                    
                    // Show mean value if available
                    if (options.meanData && d.axis) {
                        const meanData = options.meanData.find(m => m.axis === d.axis);
                        if (meanData && meanData.value !== undefined && Number.isFinite(meanData.value)) {
                            const meanVal = Math.round(meanData.value);
                            tooltipHtml += '<br/>Mean: ' + meanVal;
                        }
                    }
                }
            }
            
            tooltip.style('opacity', 1).html(tooltipHtml)
                .style('left', (e.pageX + 10) + 'px').style('top', (e.pageY + 10) + 'px');
        };

        const moveRadarTooltip = (e) => {
            tooltip.style('left', (e.pageX + 10) + 'px').style('top', (e.pageY + 10) + 'px');
        };

        const hideRadarTooltip = () => {
            tooltip.style('opacity', 0);
        };

        // Mean data layer (if provided)
        if (options.meanData && Array.isArray(options.meanData)) {
            const meanPts = svg.selectAll('.radar-mean-point').data(options.meanData);
            const enterMeanPts = meanPts.enter().append('circle')
                .attr('class', 'radar-mean-point')
                .attr('r', 0)
                .attr('cx', 0)
                .attr('cy', 0)
                .attr('fill', (d) => resolveMeanPointColor(d))
                .style('cursor', 'default')
                .style('opacity', 0.5);
            
            enterMeanPts.transition().duration(800).attr('r', 4)
                .attr('cx', (d, i) => rScale(d.value) * Math.cos(angleSlice * i - Math.PI/2))
                .attr('cy', (d, i) => rScale(d.value) * Math.sin(angleSlice * i - Math.PI/2));
            
            meanPts.transition().duration(800)
                .attr('r', 4)
                .attr('cx', (d, i) => rScale(d.value) * Math.cos(angleSlice * i - Math.PI/2))
                .attr('cy', (d, i) => rScale(d.value) * Math.sin(angleSlice * i - Math.PI/2))
                .attr('fill', (d) => resolveMeanPointColor(d));
        }

        // attach tooltip handlers on points
        svg.selectAll('.radar-point')
            .on('mouseover', (e, d) => showRadarTooltip(e, d, false))
            .on('mousemove', moveRadarTooltip)
            .on('mouseout', hideRadarTooltip);
        
        // attach tooltip handlers on mean points
        svg.selectAll('.radar-mean-point')
            .on('mouseover', (e, d) => showRadarTooltip(e, d, true))
            .on('mousemove', moveRadarTooltip)
            .on('mouseout', hideRadarTooltip);

        // attach tooltip handlers on axis labels as well
        axisLabels
            .on('mouseover', (e, d) => showRadarTooltip(e, d, false))
            .on('mousemove', moveRadarTooltip)
            .on('mouseout', hideRadarTooltip)
            .on('click', onClick ? (e, d) => onClick({ axis: d.axis }) : null);

        // allow clicking points to trigger the same onClick as axis labels (switch activity)
        if (onClick) {
            svg.selectAll('.radar-point').on('click', (e, d) => { try { onClick({ axis: d.axis }); } catch (err) { /* ignore */ } });
        }
    } catch (e) { console.warn('Radar points / tooltip setup failed', e); }
    
    // Add legend if mean data is present
    if (options.meanData && Array.isArray(options.meanData) && options.meanData.length > 0) {
        const legendTop = radius + cfg.margin - (isLargeRadar ? 20 : 14);
        const legendG = svg.append('g').attr('class', 'radar-legend');
        const legendFontSize = isLargeRadar ? 15 : 13;
        const legendDotR = isLargeRadar ? 6 : 5;

        const leftBaseX = -radius + (isLargeRadar ? 24 : 12);
        const centerGap = isLargeRadar ? 86 : 56;
        const patientX = isLargeRadar ? -centerGap : leftBaseX;
        const meanX = isLargeRadar ? centerGap : leftBaseX + 120;

        // Patient legend item
        legendG.append('circle').attr('cx', patientX).attr('cy', legendTop).attr('r', legendDotR)
            .attr('fill', polygonColor).style('opacity', 0.82);
        legendG.append('text').attr('x', patientX + 12).attr('y', legendTop).attr('dy', '0.34em')
            .style('font-size', `${legendFontSize}px`).style('font-weight', 600).style('fill', '#334155').text('Patient');

        // Mean legend item
        legendG.append('circle').attr('cx', meanX).attr('cy', legendTop).attr('r', legendDotR)
            .attr('fill', meanColor).style('opacity', 0.82);
        legendG.append('text').attr('x', meanX + 12).attr('y', legendTop).attr('dy', '0.34em')
            .style('font-size', `${legendFontSize}px`).style('font-weight', 600).style('fill', '#334155').text('Mean');
    }
}

/**
 * 6. MODAL ENLARGEMENT HANDLER
 */
window.addEventListener('openModal', (e) => {
    const { type } = e.detail;
    const modal = document.getElementById('chart-modal');
    const container = document.getElementById('modal-chart-container');
    modal.style.display = 'flex';
    container.innerHTML = '';

    if (type === 'line') {
        // Prefer the derived composite (respecting user weights) when available
        const lineData = (derivedCompositeData && derivedCompositeData.length) ? derivedCompositeData : globalCompositeData;
        document.getElementById('modal-title').textContent = 'Weekly Progress';
        renderLineChart(lineData, '#modal-chart-container', 1000, 500);
    } else if (type === 'radar-combined') {
        // enlarge both radars side-by-side
        document.getElementById('modal-title').textContent = 'Activity Analysis';
        container.innerHTML = `
            <div style="width:100%;height:100%;display:flex;gap:40px;align-items:center;justify-content:center;overflow:visible;">
                <div style="flex:1;display:flex;flex-direction:column;align-items:center;">
                    <h3 style="margin:0 0 16px 0;color:#475569;">Activities Overview</h3>
                    <div id="modal-radar-act" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:visible;"></div>
                </div>
                <div style="flex:1;display:flex;flex-direction:column;align-items:center;">
                    <h3 id="modal-radar-metrics-title" style="margin:0 0 16px 0;color:#475569;">Activity Performance</h3>
                    <div id="modal-radar-met" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:visible;"></div>
                </div>
            </div>
        `;
        renderRadarCharts('act', true);
        renderRadarCharts('met', true);
        // Update the modal metrics title with selected activity name
        const modalMetricsTitle = document.getElementById('modal-radar-metrics-title');
        if (modalMetricsTitle && selectedActivity) {
            modalMetricsTitle.textContent = `${ACTIVITY_NAMES[selectedActivity] || selectedActivity} Performance`;
        }
    } else if (type === 'weekly') {
        document.getElementById('modal-title').textContent = 'Weekly Activity Performance';
        container.innerHTML = '<div id="modal-activity-bars" style="width:100%;"></div>';
        renderActivityBars(selectedWeek, '#modal-activity-bars');
    } else {
        // fallback: render both radars
        document.getElementById('modal-title').textContent = 'Activity Radars';
        container.innerHTML = '<div id="modal-radar-act" style="flex:1;height:100%;display:flex;align-items:center;justify-content:center;overflow:visible;"></div><div id="modal-radar-met" style="flex:1;height:100%;display:flex;align-items:center;justify-content:center;overflow:visible;"></div>';
        renderRadarCharts('both', true);
    }
});

initPatientPage();
