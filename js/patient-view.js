import { loadSharedHeader } from "./main.js";

// Configuration
const ACTIVITY_NAMES = { "SC": "Stair Climbing", "STS": "Sit-To-Stand", "TUG": "Timed Up & Go", "W": "Walking" };
const ACTIVITIES = ["SC", "STS", "TUG", "W"];
const ACTIVITY_METRICS = {
    "W": ["step_time_cv_pct_norm", "symmetry_ratio_norm", "cadence_total_steps_min_norm", "gait_index_left_pct_norm", "GSI_pct_norm"],
    "STS": ["cycle_time_cv_pct_norm", "total_duration_sec_norm", "total_peaks_norm"],
    "TUG": ["total_duration_sec_norm", "total_peaks_norm", "cadence_total_steps_min_norm"],
    "SC": ["total_peaks_norm", "total_duration_sec_norm", "cadence_total_steps_min_norm"]
};

// Global State
let globalCompositeData = []; 
let activityDataSets = {};    
let selectedPatientId = 1;
let selectedWeek = null;
let selectedActivity = null;
// Weighting state and derived data
let sliderPositions = [25, 50, 75]; // three handles (percents)
let currentWeights = [25, 25, 25, 25];
let derivedCompositeData = []; // globalCompositeData remapped by currentWeights
const ACTIVITY_COLORS = { "SC": "#f59e0b", "STS": "#3b82f6", "TUG": "#06b6d4", "W": "#7c3aed" };

const tooltip = d3.select("body").append("div").attr("class", "d3-tooltip").style("opacity", 0);
const scoreColorScale = d3.scaleLinear()
    .domain([0, 50, 80, 100])
    .range(["#ef4444", "#f59e0b", "#10b981", "#059669"]);

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
function updatePatientView() {
    const weekData = derivedCompositeData.find(d => d.week === selectedWeek) || globalCompositeData.find(d => d.week === selectedWeek);
    if (!weekData) return;
    d3.select("#patient-name-header").text(`Patient ${selectedPatientId}`);
    updateSummaryHeader(weekData);
    renderLineChart(derivedCompositeData.length ? derivedCompositeData : globalCompositeData);
    renderActivityBars(selectedWeek);
    renderRadarCharts();
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
 * 4. NEW VISUALIZATION: WEEKLY ACTIVITY BARS
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

            // recompute derived composite and update views
            computeDerivedComposite();
            updatePatientView();
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
    svg.append("path").datum(data).attr("fill", "none").attr("stroke", "#3b82f6").attr("stroke-width", 2.5).attr("d", line);

    svg.selectAll("circle").data(data).enter().append("circle")
        .attr("cx", d => x(d.week)).attr("cy", d => y(d.composite_score_overall)).attr("r", 5)
        .attr("fill", d => d.week === selectedWeek ? "#f59e0b" : "#3b82f6")
        .style('cursor','pointer')
        .on("click", (e, d) => { selectedWeek = d.week; updatePatientView(); })
        .on('mouseover', (e, d) => {
            // use dark tooltip style for line chart
            tooltip.style('background', '#1e293b').style('color', '#ffffff').style('padding', '8px 10px').style('border', 'none').style('min-width','60px');
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
    const size = isEnlarged ? 400 : 260;

    const activityScores = ACTIVITIES.map(act => {
        const entry = activityDataSets[act].find(d => d.week === selectedWeek);
        return { axis: act, displayName: ACTIVITY_NAMES[act] || act, value: entry ? entry.composite_score : 0 };
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
        const metricValues = (ACTIVITY_METRICS[activity] || []).map(k => {
            const axisRaw = k.replace(/_norm|_pct/g, '').replace(/_/g, ' ').trim();
            const axis = axisRaw.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            const value = (function(){
                const raw = actWeekData ? actWeekData[k] : 0;
                const n = Number(raw);
                return (isFinite(n) ? n : 0) * 100;
            })();
            return { axis, value };
        });
        drawRadar(targetMet, [{ values: metricValues }], null, size);
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
        drawRadar(targetAct, [{ values: activityScores }], actOnClick, size);
    }

    // draw metric radar (if requested)
    if (mode === 'both' || mode === 'met') {
        drawMetricRadarFor(selectedActivity);
    }
}

function drawRadar(containerId, data, onClick, size) {
    const cfg = { w: size, h: size, margin: 60, levels: 5, maxValue: 100 };
    const container = d3.select(containerId);
    container.selectAll("*").remove();

    const radius = size/2, angleSlice = Math.PI * 2 / data[0].values.length;
    const rScale = d3.scaleLinear().range([0, radius]).domain([0, cfg.maxValue]);

    const svg = container.append("svg").attr("width", size + cfg.margin*2).attr("height", size + cfg.margin*2)
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
    axis.append("text").attr("text-anchor", "middle").attr("dy", "0.35em")
        .attr("x", (d, i) => rScale(115) * Math.cos(angleSlice*i - Math.PI/2))
        .attr("y", (d, i) => rScale(115) * Math.sin(angleSlice*i - Math.PI/2))
        .text(d => d.displayName || d.axis).style("font-size", "15px").style('font-weight', 600).style("cursor", onClick ? "pointer" : "default")
        .on("click", onClick ? (e, d) => onClick({axis: d.axis}) : null);

    // Polygon with enter transition
    const radarLine = d3.lineRadial().radius(d => rScale(d.value)).angle((d, i) => i * angleSlice).curve(d3.curveLinearClosed);
    // choose color: if axes map to activities use their color, otherwise use selectedActivity color
    const polygonColor = (data[0].values.every(v => ACTIVITY_COLORS[v.axis])) ? (ACTIVITY_COLORS[data[0].values[0].axis] || '#3b82f6') : (ACTIVITY_COLORS[selectedActivity] || '#3b82f6');

    // Start polygon at zero radius and tween to final values for a smooth animation
    const finalVals = data[0].values.map(v => ({ axis: v.axis, value: v.value }));
    const startVals = finalVals.map(v => ({ axis: v.axis, value: 0 }));
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

        // attach tooltip handlers on merged selection
        svg.selectAll('.radar-point')
            .on('mouseover', (e, d) => {
                const code = d && d.axis ? d.axis : 'Value';
                const label = ACTIVITY_NAMES[code] || code;
                const val = d && isFinite(d.value) ? Math.round(d.value) : 0;
                tooltip.style('opacity', 1).html('<strong>' + label + '</strong><br/>' + val + '%')
                    .style('left', (e.pageX + 10) + 'px').style('top', (e.pageY + 10) + 'px');
            })
            .on('mousemove', (e) => { tooltip.style('left', (e.pageX + 10) + 'px').style('top', (e.pageY + 10) + 'px'); })
            .on('mouseout', () => { tooltip.style('opacity', 0); });

        // allow clicking points to trigger the same onClick as axis labels (switch activity)
        if (onClick) {
            svg.selectAll('.radar-point').on('click', (e, d) => { try { onClick({ axis: d.axis }); } catch (err) { /* ignore */ } });
        }
    } catch (e) { console.warn('Radar points / tooltip setup failed', e); }
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
    } else if (type === 'radar-act' || type === 'radar') {
        // enlarge activities overview only
        document.getElementById('modal-title').textContent = 'Activities Overview';
        container.innerHTML = '<div id="modal-radar-act"></div>';
        renderRadarCharts('act', true);
    } else if (type === 'radar-met') {
        // enlarge metrics radar only
        const title = selectedActivity ? `${ACTIVITY_NAMES[selectedActivity] || selectedActivity} Performance` : 'Activity Performance';
        document.getElementById('modal-title').textContent = title;
        container.innerHTML = '<div id="modal-radar-met"></div>';
        renderRadarCharts('met', true);
    } else if (type === 'weekly') {
        document.getElementById('modal-title').textContent = 'Weekly Activity Performance';
        container.innerHTML = '<div id="modal-activity-bars" style="width:100%;"></div>';
        renderActivityBars(selectedWeek, '#modal-activity-bars');
    } else {
        // fallback: render both radars
        document.getElementById('modal-title').textContent = 'Activity Radars';
        container.innerHTML = '<div id="modal-radar-act"></div><div id="modal-radar-met"></div>';
        renderRadarCharts('both', true);
    }
});

initPatientPage();
