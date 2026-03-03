/**
 * VisGait - Researcher View Logic
 */

const RESEARCHER_DATA_PATH = "data/dashboard_data.csv"; // csv source file
let cachedDashboardRows = []; // used to populate with all rows in 'dashboard_data.csv'
let filteredData = []; // the filtered data from brushing in the parallel coordinates plot
// Violin filter state
let violinGroup = "All";
let violinMetricKey = "GSI_pct_norm";
// Default scatter matrix metric selection shown on first render
let selectedScatterMetricKeys = ["composite_score", "GSI_pct", "step_time_cv_pct", "symmetry_ratio"];
// Stores active brush ranges per axis
const parallelAxisFilters = {};
let parallelBrushHistory = []; // Tracks chronological order of brushed dimensions

// Scatter lasso selection state (only active in expanded/modal view)
let scatterLassoSelectedIds = new Set(); // holds "userId::week::activity" keys
let scatterLassoLocked = false;          // true while a lasso selection is active

// For finetuning sizings of the plot layout
const PLOT_LAYOUT = {
    marginRatio: { top: 0.07, right: 0.05, bottom: 0.11, left: 0.1 },
    parallelMarginRatio: { top: 0.1, right: 0.02, bottom: 0.16, left: 0.015 },
    parallelAxisPadding: 0.02,
    parallelAxisTopLabelOffset: -12,
    parallelAxisBottomLabelOffset: 24,
    parallelControlsHeightRatio: 0.14, // height preserved for controls
    violinControlsHeightRatio: 0.14
};

const METRIC_METADATA = {
    cadence_total_steps_min: { name: "Cadence", unit: "[steps/min]" },
    GSI_pct: { name: "GSI", unit: "[%]" },
    gait_index_left_pct: { name: "GIL", unit: "[%]" },
    gait_index_right_pct: { name: "GIR", unit: "[%]" },
    symmetry_ratio: { name: "Symmetry Ratio", unit: "[-]" },
    step_time_mean_sec: { name: "Step Time Mean", unit: "[s]" },
    cycle_time_mean_sec: { name: "Cycle Time Mean", unit: "[s]" }
};

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
    cycle_time_mean_sec: "Average gait cycle time in seconds.",
    total_steps: "Total step count for the session.",
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

// Colors for improving, stable, or declining patients used in scatter plot matrix & violin plots
const GROUP_COLORS = {
    improving: "#2ecc71",
    declining: "#e74c3c",
    stable: "#3498db"
};

// Scatter matrix: all available metrics
const SCATTER_METRICS = [
    { key: "composite_score", name: "Composite Score" },
    { key: "GSI_pct", name: "GSI (%)" },
    { key: "symmetry_ratio", name: "Symmetry Ratio" },
    { key: "step_time_cv_pct", name: "Step Time CV (%)" },
    { key: "cycle_time_cv_pct", name: "Cycle Time CV (%)" },
    { key: "cadence_total_steps_min", name: "Cadence (steps/min)" },
    { key: "gait_index_left_pct", name: "GI Left (%)" },
    { key: "gait_index_right_pct", name: "GI Right (%)" },
    { key: "step_time_mean_sec", name: "Step Time (s)" },
    { key: "total_steps", name: "Total Steps" }
];

const PARALLEL_METRICS = SCATTER_METRICS.slice();
const PARALLEL_ACTIVITY_ORDER = ["SC", "STS", "TUG", "W"];

const VIOLIN_METRICS = [
    { key: "GSI_pct_norm", name: "GSI" },
    { key: "symmetry_ratio_norm", name: "Symmetry" },
    { key: "gait_index_left_pct_norm", name: "GI Left" },
    { key: "gait_index_right_pct_norm", name: "GI Right" },
    { key: "step_time_cv_pct_norm", name: "Step CV" },
    { key: "cycle_time_cv_pct_norm", name: "Cycle CV" }
];

function getMetricTooltip(metricKey, fallbackLabel = "") {
    if (metricKey && METRIC_INFO[metricKey]) return METRIC_INFO[metricKey];
    if (metricKey && METRIC_METADATA[metricKey]) {
        const { name, unit } = METRIC_METADATA[metricKey];
        return `${name}${unit ? ` ${unit}` : ""}`;
    }
    return fallbackLabel || metricKey || "Metric details not available.";
}

function showMetricInfoTooltip(event, metricKey, fallbackLabel = "") {
    const tip = document.getElementById("metric-info-tooltip");
    if (!tip) return;
    tip.textContent = getMetricTooltip(metricKey, fallbackLabel);
    tip.style.display = "block";
    tip.style.left = `${event.pageX + 14}px`;
    tip.style.top = `${event.pageY - 10}px`;
}

function moveMetricInfoTooltip(event) {
    const tip = document.getElementById("metric-info-tooltip");
    if (!tip) return;
    tip.style.left = `${event.pageX + 14}px`;
    tip.style.top = `${event.pageY - 10}px`;
}

function hideMetricInfoTooltip() {
    const tip = document.getElementById("metric-info-tooltip");
    if (tip) tip.style.display = "none";
}

function ensureEnlargeButton(panelId, type) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    if (!panel.querySelector(".enlarge-btn")) {
        const btn = document.createElement("button");
        btn.className = "enlarge-btn";
        btn.type = "button";
        btn.textContent = "⛶";
        btn.onclick = () => openResearcherModal(type);
        panel.appendChild(btn);
    }
}

// loads the shared header
async function loadSharedHeader() {
    try {
        const response = await fetch("header.html");
        const html = await response.text();
        document.getElementById("header-placeholder").innerHTML = html;

        const resBtn = document.querySelector("#nav-researcher");
        if (resBtn) resBtn.classList.add("active");
    } catch (error) {
        console.error("Error loading header:", error);
    }
}

function applyPanelViewportSizing() {
    const panelIds = ["parallel-coord-plot", "line-plot-with-std", "scatter-plot-matrix", "violin-plot"];
    panelIds.forEach((panelId) => {
        const el = document.getElementById(panelId);
        if (!el) return;
        // Keep panel sizing under CSS grid control so all quadrants stay aligned.
        el.style.removeProperty("width");
        el.style.removeProperty("height");
    });
}

// Utility function for calculating consistent margins/dimensions for any chart panel
// Returns: width, height, margin, plotWidth, plotHeight
function getPlotFrame(panelId, reserveTopRatio = 0) {
    const el = document.getElementById(panelId);
    if (!el) return null;

    const parentEl = el.parentElement;
    const fallbackWidth = parentEl
        ? Math.max(320, (parentEl.clientWidth - 8) / 2)
        : Math.max(320, window.innerWidth * 0.45);
    const fallbackHeight = Math.max(240, window.innerHeight * 0.36);
    const width = el.clientWidth || fallbackWidth;
    const totalHeight = el.clientHeight || fallbackHeight;
    const height = totalHeight * (1 - reserveTopRatio);
    const margin = {
        top: height * PLOT_LAYOUT.marginRatio.top,
        right: width * PLOT_LAYOUT.marginRatio.right,
        bottom: height * PLOT_LAYOUT.marginRatio.bottom,
        left: width * PLOT_LAYOUT.marginRatio.left
    };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    return { width, height, margin, plotWidth, plotHeight };
}

// Checks if a plot row falls within all active brush selections
// Used to gray out non-selected lines and to filter downstream charts
function rowPassesParallelFilters(row, dimensions) {
    for (const dimension of dimensions) {
        const range = parallelAxisFilters[dimension];
        if (!range) continue;
        const value = row[dimension];
        if (!Number.isFinite(value) || value < range[0] || value > range[1]) {
            return false;
        }
    }
    return true;
}

function hasMeaningfulParallelValue(value) {
    // PCP hides axes that are only 0/empty across data to avoid collapsed "spike" axes.
    return Number.isFinite(value) && value !== 0;
}

function buildParallelSessions(rows) {
    const bySession = new Map();
    rows.forEach((row) => {
        const week = Number(row.week);
        if (!Number.isFinite(week)) return;
        const userId = String(row.user_id ?? "").trim();
        const sessionKey = `${userId}::${week}`;
        const activity = String(row.activity || "").trim().toUpperCase();

        if (!bySession.has(sessionKey)) {
            bySession.set(sessionKey, {
                sessionKey,
                user_id: userId,
                week,
                rows: [],
                byActivity: new Map()
            });
        }

        const session = bySession.get(sessionKey);
        session.rows.push(row);
        if (activity && !session.byActivity.has(activity)) {
            session.byActivity.set(activity, row);
        }
    });
    return Array.from(bySession.values());
}

// Build one axis per metric per activity, omitting axes with no numeric values.
function buildParallelDimensionDefs(rows) {
    const activitiesInData = Array.from(
        new Set(rows.map((row) => String(row.activity || "").trim().toUpperCase()).filter(Boolean))
    );
    const orderedActivities = PARALLEL_ACTIVITY_ORDER.filter((activity) => activitiesInData.includes(activity));
    const extraActivities = activitiesInData
        .filter((activity) => !PARALLEL_ACTIVITY_ORDER.includes(activity))
        .sort();
    const activityDomain = orderedActivities.concat(extraActivities);

    // Activity-first ordering keeps each row's valid points adjacent,
    // so paths form visible line segments instead of isolated single points.
    return activityDomain.flatMap((activity) =>
        PARALLEL_METRICS
            // STS composite_score has known discontinuity artifacts in current dataset.
            // Keep other STS metrics, but skip this one axis for readability.
            .filter((metric) => !(activity === "STS" && metric.key === "composite_score"))
            .filter((metric) =>
                rows.some((row) => {
                    if (String(row.activity || "").trim().toUpperCase() !== activity) return false;
                    return hasMeaningfulParallelValue(Number(row[metric.key]));
                })
            )
            .map((metric) => ({
                name: `${metric.name} (${activity})`,
                key: metric.key,
                activity
            }))
    );
}

function updateParallelFilterControls(activeFilterCount, filteredLineCount, totalLineCount) {
    const controlsEl = document.getElementById("parallel-filter-controls");
    if (!controlsEl) return;

    const statusEl = controlsEl.querySelector(".parallel-filter-status");
    if (statusEl) {
        if (activeFilterCount > 0) {
            statusEl.textContent = `${filteredLineCount}/${totalLineCount} lines`;
        } else {
            statusEl.textContent = `${totalLineCount}/${totalLineCount} lines`;
        }
    }

    const undoBtn = controlsEl.querySelector("#parallel-undo-filters");
    if (undoBtn) {
        undoBtn.disabled = parallelBrushHistory.length === 0;
    }
}

// Function which handles the syncing of the filtered data between all plot charts. It calls all other charts with filteredData
// 1. Counts how many filters are active
// 2. If no filters -> filteredData = all rows (reset button has been clicked)
// 3. If filters active -> keep rows passing all active axis filters
// 4. Update the status text
// 5. Re-render the other 3 charts with the filtered data in parallel
async function syncFilteredDatasetFromParallel(parallelRows, dimensions) {
    const activeFilterCount = Object.values(parallelAxisFilters).filter((range) => Array.isArray(range) && range.length === 2).length;
    const sourceRows = Array.isArray(parallelRows) ? parallelRows : [];
    const filteredParallelRows = activeFilterCount
        ? sourceRows.filter((row) => rowPassesParallelFilters(row, dimensions))
        : sourceRows.slice();
    const totalLineCount = sourceRows.length;
    const filteredLineCount = filteredParallelRows.length;

    if (!activeFilterCount) {
        filteredData = cachedDashboardRows.slice();
    } else if (filteredParallelRows.length && Array.isArray(filteredParallelRows[0].__rawRows)) {
        // PCP lines represent patient-week sessions; flatten back to original row granularity.
        filteredData = filteredParallelRows.flatMap((row) => row.__rawRows);
    } else if (filteredParallelRows.length && filteredParallelRows[0].__raw) {
        filteredData = filteredParallelRows.map((row) => row.__raw);
    } else {
        filteredData = [];
    }

    updateParallelFilterControls(activeFilterCount, filteredLineCount, totalLineCount);
    await Promise.all([
        renderLinePlotWithStd(filteredData),
        renderScatterPlotMatrix(filteredData),
        renderViolinPlot(filteredData)
    ]);
}

// Parallel coords plot function. Draws one line per patient-week session.
async function renderParallelCoordinatesPlot(rows) {
    if (!window.d3) {
        console.error("D3 did not load. The parallel coordinates plot cannot render.");
        return;
    }

    const container = d3.select("#parallel-coord-plot");
    container.selectAll("*").remove();
    ensureEnlargeButton("parallel-coord-plot", "parallel");

    const hostEl = document.getElementById("parallel-coord-plot");
    if (!hostEl) return;

    const dimensionDefs = buildParallelDimensionDefs(rows);
    const dimensions = dimensionDefs.map((def) => def.name);
    const keyByDimension = dimensionDefs.reduce((acc, def) => {
        acc[def.name] = def.key;
        return acc;
    }, {});

    const sessions = buildParallelSessions(rows);
    const data = sessions
        .map((session, index) => {
            const next = {
                __rawRows: session.rows,
                __index: index,
                __sessionKey: session.sessionKey
            };
            dimensionDefs.forEach((def) => {
                const sourceRow = session.byActivity.get(def.activity);
                const value = sourceRow ? Number(sourceRow[def.key]) : NaN;
                const isPresent = hasMeaningfulParallelValue(value);
                next[def.name] = isPresent ? value : NaN;
            });
            return next;
        })
        .filter((row) => dimensions.filter((dimension) => Number.isFinite(row[dimension])).length >= 2);

    let isRestoringBrush = false;
    const brushesByDim = {};
    let applyLineStyles = () => {};

    const toolbar = container.append("div").attr("class", "pcp-toolbar");
    const legendBar = toolbar.append("div").attr("class", "pcp-controls-bar");
    legendBar.append("label").text("Groups:");
    const legend = legendBar.append("div").attr("class", "pcp-legend");
    Object.entries(GROUP_COLORS).forEach(([group, color]) => {
        const item = legend.append("span").attr("class", "pcp-legend-item");
        item.append("span").attr("class", "pcp-legend-swatch").style("background", color);
        item.append("span").text(group.charAt(0).toUpperCase() + group.slice(1));
    });

    const controls = toolbar
        .append("div")
        .attr("class", "parallel-filter-controls")
        .attr("id", "parallel-filter-controls");

    controls
        .append("button")
        .attr("type", "button")
        .text("Reset filters")
        .on("click", async () => {
            if (Object.keys(parallelAxisFilters).length === 0) return;

            isRestoringBrush = true;
            parallelBrushHistory = [];
            Object.keys(parallelAxisFilters).forEach((dimension) => {
                delete parallelAxisFilters[dimension];
                if (brushesByDim[dimension]) {
                    brushesByDim[dimension].group.call(brushesByDim[dimension].brush.move, null);
                }
            });
            isRestoringBrush = false;

            applyLineStyles();
            await syncFilteredDatasetFromParallel(data, dimensions);
        });

    controls
        .append("button")
        .attr("type", "button")
        .attr("id", "parallel-undo-filters")
        .text("Undo")
        .property("disabled", true)
        .on("click", async () => {
            while (parallelBrushHistory.length > 0) {
                const lastDimension = parallelBrushHistory.pop();
                if (parallelAxisFilters[lastDimension]) {
                    delete parallelAxisFilters[lastDimension];
                    
                    isRestoringBrush = true;
                    if (brushesByDim[lastDimension]) {
                        brushesByDim[lastDimension].group.call(brushesByDim[lastDimension].brush.move, null);
                    }
                    isRestoringBrush = false;

                    applyLineStyles();
                    await syncFilteredDatasetFromParallel(data, dimensions);
                    return;
                }
            }
        });

    controls.append("div").attr("class", "parallel-filter-status");

    if (!data.length) {
        container.append("div").attr("class", "parallel-empty").text("No numeric data for parallel coordinates.");
        filteredData = cachedDashboardRows.slice();
        updateParallelFilterControls(0, 0, 0);
        await Promise.all([
            renderLinePlotWithStd(filteredData),
            renderScatterPlotMatrix(filteredData),
            renderViolinPlot(filteredData)
        ]);
        return;
    }

    const panelWidth = Math.max(320, hostEl.clientWidth || 0);
    const panelHeight = Math.max(240, hostEl.clientHeight || 0);
    const controlsHeight = panelHeight * PLOT_LAYOUT.parallelControlsHeightRatio;
    const viewportHeight = Math.max(160, panelHeight - controlsHeight - 18);
    const axisSpacing = dimensions.length > 20 ? 185 : 160;
    const chartWidth = Math.max(panelWidth - 8, axisSpacing * (dimensions.length - 1) + 90);
    const chartHeight = viewportHeight;
    const parallelMarginRatio = PLOT_LAYOUT.parallelMarginRatio;
    const margin = {
        top: chartHeight * parallelMarginRatio.top,
        right: chartWidth * parallelMarginRatio.right,
        bottom: chartHeight * parallelMarginRatio.bottom,
        left: chartWidth * parallelMarginRatio.left
    };
    const plotWidth = chartWidth - margin.left - margin.right;
    const plotHeight = chartHeight - margin.top - margin.bottom;

    const scrollWrap = container
        .append("div")
        .attr("class", "parallel-scroll-wrap")
        .style("height", `${viewportHeight}px`);

    const svg = scrollWrap
        .append("svg")
        .attr("width", chartWidth)
        .attr("height", chartHeight)
        .attr("viewBox", `0 0 ${chartWidth} ${chartHeight}`)
        .attr("preserveAspectRatio", "none");

    let isDragging = false;
    let dragStartX = 0;
    let dragStartScroll = 0;
    // Makes the parallel coords plot dragable horizontally
    scrollWrap
        .on("mousedown", (event) => {
            if (event.target.closest(".pc-brush")) return;
            isDragging = true;
            dragStartX = event.clientX;
            dragStartScroll = scrollWrap.node().scrollLeft;
        })
        .on("mousemove", (event) => {
            if (!isDragging) return;
            event.preventDefault();
            const dx = event.clientX - dragStartX;
            scrollWrap.node().scrollLeft = dragStartScroll - dx;
        })
        .on("mouseup", () => {
            isDragging = false;
        })
        .on("mouseleave", () => {
            isDragging = false;
        });

    const chart = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const x = d3.scalePoint().domain(dimensions).range([0, plotWidth]).padding(PLOT_LAYOUT.parallelAxisPadding);

    // One vertical scale per axis, linearly scaled, autofitted.
    const yByDimension = {};
    dimensions.forEach((dimension) => {
        const values = data.map((row) => row[dimension]).filter((value) => Number.isFinite(value));
        const extent = d3.extent(values);
        if (!values.length || !Number.isFinite(extent[0]) || !Number.isFinite(extent[1])) {
            yByDimension[dimension] = d3.scaleLinear().domain([0, 1]).range([plotHeight, 0]);
            return;
        }
        yByDimension[dimension] = d3
            .scaleLinear()
            .domain(extent[0] === extent[1] ? [extent[0] - 1, extent[1] + 1] : extent)
            .nice()
            .range([plotHeight, 0]);
    });

    const line = d3
        .line()
        .defined(([, value]) => Number.isFinite(value))
        .x(([dimension]) => x(dimension))
        .y(([dimension, value]) => yByDimension[dimension](value));

    const lineSelection = chart
        .selectAll(".pc-line")
        .data(data)
        .enter()
        .append("path")
        .attr("class", "pc-line")
        .attr("fill", "none")
        .attr("d", (row) => line(dimensions.map((dimension) => [dimension, row[dimension]])));

    applyLineStyles = () => {
        lineSelection
            .attr("stroke", (row) => {
                if (!rowPassesParallelFilters(row, dimensions)) return "#d1d5db";
                const group = String(row.__rawRows?.[0]?.user_group || "").toLowerCase();
                return GROUP_COLORS[group] || "#2563eb";
            })
            .attr("stroke-width", (row) => (rowPassesParallelFilters(row, dimensions) ? 1.3 : 1))
            .attr("opacity", (row) => (rowPassesParallelFilters(row, dimensions) ? 0.55 : 0.08));
    };

    const axis = chart
        .selectAll(".pc-axis")
        .data(dimensions)
        .enter()
        .append("g")
        .attr("class", "pc-axis")
        .attr("transform", (dimension) => `translate(${x(dimension)},0)`)
        .each(function(dimension) {
            d3.select(this).call(d3.axisLeft(yByDimension[dimension]).ticks(5));
        });

    axis
        .append("text")
        .attr("y", PLOT_LAYOUT.parallelAxisTopLabelOffset)
        .attr("text-anchor", "middle")
        .attr("fill", "#111")
        .style("font-size", "11px")
        .style("cursor", "help")
        .text((dimension) => dimension)
        .on("mouseover", (event, dimension) => {
            showMetricInfoTooltip(event, keyByDimension[dimension], dimension);
        })
        .on("mousemove", (event) => moveMetricInfoTooltip(event))
        .on("mouseout", () => hideMetricInfoTooltip());

    axis
        .append("text")
        .attr("y", plotHeight + PLOT_LAYOUT.parallelAxisBottomLabelOffset)
        .attr("text-anchor", "middle")
        .attr("fill", "#64748b")
        .style("font-size", "11px")
        .text((dimension) => keyByDimension[dimension] || "");

    axis.each(function(dimension) {
        const axisGroup = d3.select(this);
        const brush = d3
            .brushY()
            .extent([[-10, 0], [10, plotHeight]])
            .on("brush end", async (event) => {
                if (isRestoringBrush) return;

                if (!event.selection) {
                    delete parallelAxisFilters[dimension];
                    parallelBrushHistory = parallelBrushHistory.filter(d => d !== dimension);
                } else {
                    const [top, bottom] = event.selection;
                    const max = yByDimension[dimension].invert(top);
                    const min = yByDimension[dimension].invert(bottom);
                    parallelAxisFilters[dimension] = [Math.min(min, max), Math.max(min, max)];
                    
                    // Always make the freshly tweaked brush the most recent action
                    parallelBrushHistory = parallelBrushHistory.filter(d => d !== dimension);
                    parallelBrushHistory.push(dimension);
                }

                applyLineStyles();
                await syncFilteredDatasetFromParallel(data, dimensions);
            });

        const brushGroup = axisGroup.append("g").attr("class", "pc-brush").call(brush);
        brushesByDim[dimension] = { brush, group: brushGroup };

        const range = parallelAxisFilters[dimension];
        if (range) {
            isRestoringBrush = true;
            brushGroup.call(brush.move, [yByDimension[dimension](range[1]), yByDimension[dimension](range[0])]);
            isRestoringBrush = false;
        }
    });

    applyLineStyles();
    await syncFilteredDatasetFromParallel(data, dimensions);
}

function getStandardDeviation(array) {
    const n = array.length;
    if (!n) return 0;
    const mean = array.reduce((a, b) => a + b, 0) / n;
    return Math.sqrt(array.map((x) => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / n);
}

async function renderLinePlotWithStd(rows) {
    if (!window.d3) {
        console.error("D3 did not load. The LineChart cannot render.");
        return;
    }

    const container = d3.select("#line-plot-with-std");
    container.html("");
    ensureEnlargeButton("line-plot-with-std", "line");

    const frame = getPlotFrame("line-plot-with-std");
    if (!frame) return;
    const { width, height, margin, plotWidth, plotHeight } = frame;

    // Group raw rows by (week, activity) so we can compute mean +/- std per line metric.
    const byWeekActivity = new Map();
    rows.forEach((row) => {
        const activity = String(row.activity || "").trim().toUpperCase();
        if (activity !== "W" && activity !== "TUG") return;
        const week = Number(row.week);
        if (!Number.isFinite(week)) return;

        const key = `${week}-${activity}`;
        if (!byWeekActivity.has(key)) {
            byWeekActivity.set(key, {
                week,
                activity,
                gsi: [],
                gir: [],
                gil: []
            });
        }

        const bucket = byWeekActivity.get(key);
        const gsi = Number(row.GSI_pct);
        const gir = Number(row.gait_index_right_pct);
        const gil = Number(row.gait_index_left_pct);

        if (Number.isFinite(gsi)) bucket.gsi.push(gsi);
        if (Number.isFinite(gir)) bucket.gir.push(gir);
        if (Number.isFinite(gil)) bucket.gil.push(gil);
    });

    let maxWeek = 0;
    let minWeek = Number.POSITIVE_INFINITY;
    let maxValue = 0;
    let minValue = Number.POSITIVE_INFINITY;
    const weekMap = new Map();
    byWeekActivity.forEach((entry) => {
        if (!weekMap.has(entry.week)) weekMap.set(entry.week, { week: entry.week });
        const target = weekMap.get(entry.week);
        const prefix = entry.activity === "TUG" ? "TUG" : "W";
        const mean = (arr) => (arr.length ? d3.mean(arr) : NaN);
        const metrics = [
            { key: "GSI", values: entry.gsi },
            { key: "GIR", values: entry.gir },
            { key: "GIL", values: entry.gil }
        ];

        maxWeek = Math.max(maxWeek, entry.week);
        minWeek = Math.min(minWeek, entry.week);

        metrics.forEach(({ key, values }) => {
            const avg = mean(values);
            const std = getStandardDeviation(values);
            maxValue = Math.max(maxValue, avg + std);
            minValue = Math.min(minValue, avg - std);
            target[`${key}-${prefix}`] = avg;
            target[`${key}-${prefix}-STD`] = std;
        });
    });

    const predefinedDimensions = ["GSI-TUG", "GSI-W", "GIR-TUG", "GIL-TUG", "GIR-W", "GIL-W"];
    let dimensions = [...predefinedDimensions];
    const data = Array.from(weekMap.values())
        .map((row) => ({
            week: row.week,
            "GSI-TUG": row["GSI-TUG"],
            "GSI-W": row["GSI-W"],
            "GIR-TUG": row["GIR-TUG"],
            "GIL-TUG": row["GIL-TUG"],
            "GIR-W": row["GIR-W"],
            "GIL-W": row["GIL-W"],
            "GSI-TUG-STD": row["GSI-TUG-STD"],
            "GSI-W-STD": row["GSI-W-STD"],
            "GIR-TUG-STD": row["GIR-TUG-STD"],
            "GIL-TUG-STD": row["GIL-TUG-STD"],
            "GIR-W-STD": row["GIR-W-STD"],
            "GIL-W-STD": row["GIL-W-STD"]
        }))
        .sort((a, b) => a.week - b.week);

    if (!data.length || !Number.isFinite(minWeek) || !Number.isFinite(maxWeek)) {
        container.text("No line chart data available.");
        return;
    }

    const svg = container
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .style("width", "100%")
        .style("height", "100%");

    const chart = svg
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const y = d3.scaleLinear().range([plotHeight, 0]);
    const yAxisGroup = chart.append("g").attr("class", "y-axis");
    const x = d3.scaleLinear().range([0, plotWidth]);

    x.domain([minWeek, maxWeek]);
    chart
        .append("g")
        .attr("transform", `translate(0,${plotHeight})`)
        .call(d3.axisBottom(x));

    svg.append("text")
        .attr("class", "x label")
        .attr("text-anchor", "end")
        .attr("x", width / 2 + 50)
        .attr("y", height - 5)
        .text("Weeks");

    svg.append("text")
        .attr("class", "y label")
        .attr("text-anchor", "middle")
        .attr("y", 50)
        .attr("x", -height / 2)
        .attr("dy", ".75em")
        .attr("transform", "rotate(-90)")
        .text("Metric");

    const tooltip = ensureTooltip();
    const controlsDiv = container.append("div").attr("class", "scatter-controls");
    controlsDiv.append("div").attr("class", "scatter-controls-label").text("Metrics");

    const color = d3.scaleOrdinal().domain(predefinedDimensions).range(d3.schemeCategory10);
    predefinedDimensions.forEach((metric) => {
        const label = controlsDiv.append("label").attr("class", "linechart-check-label");
        label
            .append("input")
            .attr("type", "checkbox")
            .property("checked", dimensions.includes(metric))
            .on("change", function() {
                if (this.checked) {
                    if (!dimensions.includes(metric)) dimensions.push(metric);
                } else {
                    if (dimensions.length <= 1) {
                        this.checked = true;
                        return;
                    }
                    dimensions = dimensions.filter((d) => d !== metric);
                }
                updateLinePlotWithStdChart(dimensions, chart, data, x, y, yAxisGroup, tooltip, color, minValue, maxValue);
            });
        label.append("span").attr("class", "color-dot").style("background-color", color(metric));
        label.append("span").text(metric);
        label
            .style("cursor", "pointer")
            .on("mouseover", (event) => showMetricInfoTooltip(event, metric))
            .on("mousemove", (event) => moveMetricInfoTooltip(event))
            .on("mouseout", () => hideMetricInfoTooltip());
    });

    updateLinePlotWithStdChart(dimensions, chart, data, x, y, yAxisGroup, tooltip, color, minValue, maxValue);
}

function updateLinePlotWithStdChart(dimensions, chart, data, x, y, yAxisGroup, tooltip, color, fallbackMin, fallbackMax) {
    const allValues = [];
    dimensions.forEach((dimension) => {
        data.forEach((row) => {
            const mean = row[dimension];
            const std = row[`${dimension}-STD`] || 0;
            if (Number.isFinite(mean)) {
                allValues.push(mean + std);
                allValues.push(mean - std);
            }
        });
    });

    // Dynamic y-domain keeps visible metrics framed even when users toggle checkboxes.
    const rawMin = allValues.length ? d3.min(allValues) : fallbackMin;
    const rawMax = allValues.length ? d3.max(allValues) : fallbackMax;
    const min = Number.isFinite(rawMin) ? rawMin : 0;
    const max = Number.isFinite(rawMax) ? rawMax : 1;
    const yMin = Math.max(0, min);
    const yMax = max <= yMin ? yMin + 1 : max;
    y.domain([yMin, yMax]);
    yAxisGroup.call(d3.axisLeft(y));

    chart.selectAll(".metric-line").remove();
    chart.selectAll(".std-area").remove();
    chart.selectAll(".pointmarkers").remove();

    dimensions.forEach((dimension) => {
        const lineGroup = chart.append("g");
        const areaToShade = d3
            .area()
            .defined((d) => Number.isFinite(d[dimension]) && Number.isFinite(d[`${dimension}-STD`]))
            .x((d) => x(d.week))
            .y0((d) => y(Math.max(0, d[dimension] - d[`${dimension}-STD`])))
            .y1((d) => y(d[dimension] + d[`${dimension}-STD`]));
        lineGroup
            .append("path")
            .datum(data)
            .attr("class", "std-area")
            .attr("fill", color(dimension))
            .attr("opacity", 0.5)
            .style("pointer-events", "none")
            .attr("d", areaToShade);
    });

    dimensions.forEach((dimension) => {
        const lineGroup = chart.append("g");
        const line = d3
            .line()
            .defined((d) => Number.isFinite(d[dimension]))
            .x((d) => x(d.week))
            .y((d) => y(d[dimension]));

        lineGroup
            .append("path")
            .datum(data)
            .attr("class", "metric-line")
            .attr("fill", "none")
            .attr("stroke", color(dimension))
            .attr("stroke-width", 1)
            .style("pointer-events", "none")
            .attr("d", line);

        lineGroup
            .selectAll("circle")
            .data(data.filter((d) => Number.isFinite(d[dimension])))
            .enter()
            .append("circle")
            .attr("class", "pointmarkers")
            .attr("cx", (d) => x(d.week))
            .attr("cy", (d) => y(d[dimension]))
            .attr("r", 3)
            .style("cursor", "pointer")
            .style("pointer-events", "all")
            .on("mouseover", (event, d) => {
                const wk = d && d.week ? d.week : "?";
                const value = d[dimension];
                const stdValue = d[`${dimension}-STD`];
                tooltip
                    .style("display", "block")
                    .html(`Week: ${wk}<br/>${dimension}: ${value}<br/>${dimension}-STD: ${stdValue}`);
            })
            .on("mousemove", (event) => {
                tooltip
                    .style("left", `${event.pageX + 12}px`)
                    .style("top", `${event.pageY - 28}px`);
            })
            .on("mouseout", () => tooltip.style("display", "none"));
    });

    chart.selectAll("circle").raise();
}

// Called on researcher load and checkbox changes:
// builds the metric checkbox panel and draws the scatter matrix from active selections.
async function renderScatterPlotMatrix(rows = []) {
    if (!window.d3) {
        console.error("D3 did not load. The scatter plot cannot render.");
        return;
    }

    const container = d3.select("#scatter-plot-matrix");
    container.selectAll("*").remove();
    ensureEnlargeButton("scatter-plot-matrix", "scatter");
    const hostEl = document.getElementById("scatter-plot-matrix");
    if (!hostEl) return;

    const parsedRows = rows.map((row) => {
        const next = {
            user_id: row.user_id,
            week: row.week,
            activity: row.activity,
            user_group: row.user_group
        };
        SCATTER_METRICS.forEach((metric) => {
            next[metric.key] = Number(row[metric.key]);
        });
        return next;
    });

    const controlsDiv = container.append("div").attr("class", "scatter-controls");
    controlsDiv.append("div").attr("class", "scatter-controls-label").text("Metrics");

    const availableMetrics = SCATTER_METRICS.filter((metric) =>
        parsedRows.some((row) => Number.isFinite(row[metric.key]))
    );

    if (availableMetrics.length < 2) {
        container
            .append("div")
            .attr("class", "scatter-empty")
            .text(`Not enough numeric scatter metrics in ${rows.length} rows.`);
        return;
    }

    selectedScatterMetricKeys = selectedScatterMetricKeys.filter((key) =>
        availableMetrics.some((metric) => metric.key === key)
    );
    if (selectedScatterMetricKeys.length < 2) {
        selectedScatterMetricKeys = availableMetrics.slice(0, 4).map((metric) => metric.key);
        if (selectedScatterMetricKeys.length < 2) {
            selectedScatterMetricKeys = availableMetrics.slice(0, 2).map((metric) => metric.key);
        }
    }

    const svgWrap = container.append("div").attr("class", "scatter-svg-wrap");
    const redraw = () => {
        const activeMetrics = availableMetrics.filter((metric) =>
            selectedScatterMetricKeys.includes(metric.key)
        );
        drawScatterMatrixSvg(parsedRows, activeMetrics, svgWrap.node());
    };

    availableMetrics.forEach((metric) => {
        const label = controlsDiv.append("label").attr("class", "scatter-check-label");
        const input = label
            .append("input")
            .attr("type", "checkbox")
            .attr("value", metric.key)
            .property("checked", selectedScatterMetricKeys.includes(metric.key))
            .on("change", function() {
                const checked = this.checked;
                if (checked) {
                    if (!selectedScatterMetricKeys.includes(metric.key)) {
                        selectedScatterMetricKeys.push(metric.key);
                    }
                } else {
                    // Keep at least 2 active metrics; fewer cannot form a scatter comparison.
                    if (selectedScatterMetricKeys.length <= 2) {
                        this.checked = true;
                        return;
                    }
                    selectedScatterMetricKeys = selectedScatterMetricKeys.filter((key) => key !== metric.key);
                }
                redraw();
            });
        label.append("span").text(metric.name);
        label
            .style("cursor", "pointer")
            .on("mouseover", (event) => showMetricInfoTooltip(event, metric.key, metric.name))
            .on("mousemove", (event) => moveMetricInfoTooltip(event))
            .on("mouseout", () => hideMetricInfoTooltip());
    });

    // Lasso instruction hint (only shown when expanded)
    controlsDiv.append("div")
        .attr("class", "scatter-lasso-hint")
        .html(
            '<strong>Lasso tool</strong><br>' +
            'Expand the plot, then click and drag a rectangle on any scatter cell to highlight points. ' +
            'Click "Clear selection" to reset.'
        );

    redraw();
}

// Builds activity/group filters and draws the violin plot for the filtered rows.
async function renderViolinPlot(rows) {
    if (!window.d3) {
        console.error("D3 did not load. The violin plot cannot render.");
        return;
    }

    const container = d3.select("#violin-plot");
    container.selectAll("*").remove();
    ensureEnlargeButton("violin-plot", "violin");

    const el = document.getElementById("violin-plot");
    if (!el) return;

    const controls = container.append("div").attr("class", "violin-filters");
    controls.append("label").text("Metric:");
    const metricSelect = controls
        .append("select")
        .attr("id", "violin-metric-select")
        .on("change", function() {
            violinMetricKey = this.value;
            renderViolinPlot(filteredData.length ? filteredData : cachedDashboardRows);
        });
    VIOLIN_METRICS.forEach((metric) => {
        metricSelect
            .append("option")
            .attr("value", metric.key)
            .property("selected", metric.key === violinMetricKey)
            .text(metric.name);
    });

    controls.append("label").text("Group:");
    controls
        .append("select")
        .attr("id", "violin-group-select")
        .on("change", function() {
            violinGroup = this.value;
            renderViolinPlot(filteredData.length ? filteredData : cachedDashboardRows);
        })
        .selectAll("option")
        .data(["All", "improving", "declining", "stable"])
        .enter()
        .append("option")
        .attr("value", (d) => d)
        .property("selected", (d) => d === violinGroup)
        .text((d) => (d === "All" ? "All" : d.charAt(0).toUpperCase() + d.slice(1)));

    let filteredRows = rows;
    if (violinGroup !== "All") {
        filteredRows = filteredRows.filter((row) => String(row.user_group || "").toLowerCase() === violinGroup);
    }

    const selectedMetric = VIOLIN_METRICS.find((metric) => metric.key === violinMetricKey) || VIOLIN_METRICS[0];
    violinMetricKey = selectedMetric.key;
    const values = filteredRows
        .map((row) => Number(row[selectedMetric.key]))
        .filter((value) => Number.isFinite(value));

    const chartWrap = container.append("div").attr("class", "violin-chart-wrap");
    const frame = getPlotFrame("violin-plot", PLOT_LAYOUT.violinControlsHeightRatio);
    if (!frame) return;
    const { width, height, margin, plotWidth, plotHeight } = frame;

    if (!values.length) {
        chartWrap.append("div").attr("class", "violin-empty").text("No data for selected filters.");
        return;
    }

    const tooltip = ensureTooltip();
    const fillColor = violinGroup !== "All" ? (GROUP_COLORS[violinGroup] || "#83b2ff") : "#83b2ff";
    const strokeColor = violinGroup === "improving"
        ? "#1a6b3f"
        : violinGroup === "declining"
            ? "#8b1a1a"
            : violinGroup === "stable"
                ? "#1a4a8a"
                : "#1a3a8a";

    const svg = chartWrap
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    const chart = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const yExtent = d3.extent(values);
    const yPad = (yExtent[1] - yExtent[0]) * 0.1 || 1;
    const y = d3.scaleLinear().domain([yExtent[0] - yPad, yExtent[1] + yPad]).nice().range([plotHeight, 0]);

    chart.append("g").call(d3.axisLeft(y).ticks(6));
    chart
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -plotHeight / 2)
        .attr("y", -38)
        .attr("text-anchor", "middle")
        .style("font-size", "12px")
        .style("cursor", "help")
        .text(selectedMetric.name)
        .on("mouseover", (event) => showMetricInfoTooltip(event, selectedMetric.key, selectedMetric.name))
        .on("mousemove", (event) => moveMetricInfoTooltip(event))
        .on("mouseout", () => hideMetricInfoTooltip());

    const bandwidth = Math.max(0.01, ((yExtent[1] - yExtent[0]) || 1) * 0.08);
    const kde = kernelDensityEstimator(kernelEpanechnikov(bandwidth), y.ticks(50));
    const density = kde(values);
    const maxDensity = d3.max(density, (d) => d[1]) || 1;
    const violinWidth = plotWidth * 0.6;
    const xDensity = d3.scaleLinear().domain([-maxDensity, maxDensity]).range([0, violinWidth]);
    const violinG = chart.append("g").attr("transform", `translate(${plotWidth / 2 - violinWidth / 2},0)`);

    violinG
        .append("path")
        .datum(density)
        .attr("fill", fillColor)
        .attr("fill-opacity", 0.65)
        .attr("stroke", strokeColor)
        .attr("stroke-width", 1)
        .attr(
            "d",
            d3
                .area()
                .x0((d) => xDensity(-d[1]))
                .x1((d) => xDensity(d[1]))
                .y((d) => y(d[0]))
                .curve(d3.curveCatmullRom)
        );

    const sorted = values.slice().sort(d3.ascending);
    const q1 = d3.quantile(sorted, 0.25);
    const median = d3.quantile(sorted, 0.5);
    const q3 = d3.quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const wLow = Math.max(d3.min(values), q1 - 1.5 * iqr);
    const wHigh = Math.min(d3.max(values), q3 + 1.5 * iqr);
    const cx = violinWidth / 2;

    violinG.append("line").attr("x1", cx).attr("x2", cx).attr("y1", y(wHigh)).attr("y2", y(q3)).attr("stroke", strokeColor).attr("stroke-width", 1);
    violinG.append("line").attr("x1", cx).attr("x2", cx).attr("y1", y(q1)).attr("y2", y(wLow)).attr("stroke", strokeColor).attr("stroke-width", 1);
    violinG.append("rect").attr("x", cx - 8).attr("y", y(q3)).attr("width", 16).attr("height", Math.max(1, y(q1) - y(q3))).attr("fill", "#fff").attr("stroke", strokeColor).attr("stroke-width", 1.5);
    violinG.append("line").attr("x1", cx - 8).attr("x2", cx + 8).attr("y1", y(median)).attr("y2", y(median)).attr("stroke", "#e74c3c").attr("stroke-width", 2);

    violinG
        .append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", violinWidth)
        .attr("height", plotHeight)
        .attr("fill", "transparent")
        .on("mouseover", () => {
            const grpLabel = violinGroup === "All" ? "All groups" : violinGroup;
            tooltip
                .style("display", "block")
                .html(
                    `<strong>${selectedMetric.name}</strong> - ${grpLabel}<br>` +
                    `Median: ${median.toFixed(3)}<br>` +
                    `Q1: ${q1.toFixed(3)} | Q3: ${q3.toFixed(3)}<br>` +
                    `Min: ${d3.min(values).toFixed(3)} | Max: ${d3.max(values).toFixed(3)}<br>` +
                    `n = ${values.length}`
                );
        })
        .on("mousemove", (event) => {
            tooltip.style("left", `${event.pageX + 12}px`).style("top", `${event.pageY - 28}px`);
        })
        .on("mouseout", () => tooltip.style("display", "none"));
}

// Helpers for kernel density estimate (used by violin plot)
function kernelDensityEstimator(kernel, X) {
    return function(V) {
        return X.map(function(x) {
            return [x, d3.mean(V, function(v) { return kernel(x - v); })];
        });
    };
}

function kernelEpanechnikov(k) {
    return function(v) {
        return Math.abs(v /= k) <= 1 ? 0.75 * (1 - v * v) / k : 0;
    };
}

// Generates a unique row key for lasso identification.
function scatterRowKey(row) {
    return `${row.user_id}::${row.week}::${row.activity}`;
}

// Apply lasso highlight styling to all scatter circles in the SVG.
function applyScatterLassoStyles(svgEl) {
    if (!svgEl) return;
    const hasSelection = scatterLassoSelectedIds.size > 0;
    d3.select(svgEl)
        .selectAll("circle.sc-dot")
        .attr("fill", (row) => {
            if (!hasSelection) return GROUP_COLORS[String(row.user_group || "").toLowerCase()] || "#9ca3af";
            return scatterLassoSelectedIds.has(scatterRowKey(row)) ? "#b026ff" : "#d1d5db";
        })
        .attr("fill-opacity", (row) => {
            if (!hasSelection) return 0.5;
            // Adjust the 0.35 value below to control how visible unselected dots are (0 = invisible, 1 = full).
            return scatterLassoSelectedIds.has(scatterRowKey(row)) ? 0.9 : 0.35;
        })
        .attr("r", (row) => {
            if (!hasSelection) return 3;
            // Adjust selected (3.5) and unselected (1.8) radius here.
            return scatterLassoSelectedIds.has(scatterRowKey(row)) ? 3.5 : 1.8;
        });
}

// D3 renderer for scatter matrix SVG.
// Receives parsed rows, active metrics, and the wrapper element to draw into.
function drawScatterMatrixSvg(data, metrics, wrapEl) {
    if (!wrapEl) return;
    wrapEl.innerHTML = "";

    const n = metrics.length;
    if (n < 2) return;

    // Detect whether we are inside the expanded modal.
    const isExpanded = !!wrapEl.closest(".modal-plot-live");

    const totalWidth = Math.max(1, wrapEl.clientWidth);
    const totalHeight = Math.max(1, wrapEl.clientHeight);
    const gap = 3;
    const cellW = Math.floor((totalWidth - gap * (n + 1)) / n);
    const cellH = Math.floor((totalHeight - gap * (n + 1)) / n);
    const ip = { top: 14, right: 4, bottom: 14, left: 20 };
    const innerW = cellW - ip.left - ip.right;
    const innerH = cellH - ip.top - ip.bottom;

    // Clear lasso state when redrawing (e.g. checkbox change)
    scatterLassoSelectedIds.clear();
    scatterLassoLocked = false;
    // Remove clear-lasso button if it exists
    const existingClearBtn = wrapEl.parentElement?.querySelector(".scatter-lasso-clear-btn");
    if (existingClearBtn) existingClearBtn.remove();

    const svg = d3
        .select(wrapEl)
        .append("svg")
        .attr("viewBox", `0 0 ${totalWidth} ${totalHeight}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .style("width", "100%")
        .style("height", "100%");

    const tooltip = ensureTooltip();

    // Track all cell brushes so we can clear others when one fires.
    const cellBrushes = [];

    metrics.forEach((rowMetric, rowIndex) => {
        metrics.forEach((colMetric, colIndex) => {
            const cellX = gap + colIndex * (cellW + gap);
            const cellY = gap + rowIndex * (cellH + gap);
            const cellGroup = svg.append("g").attr("transform", `translate(${cellX},${cellY})`);

            cellGroup
                .append("rect")
                // Background rectangle for each cell. Diagonal cells are tinted as label cells.
                .attr("width", cellW)
                .attr("height", cellH)
                .attr("fill", rowIndex === colIndex ? "#eef2ff" : "#fafafa")
                .attr("stroke", "#d1d5db")
                .attr("stroke-width", 0.5);

            const plotGroup = cellGroup.append("g").attr("transform", `translate(${ip.left},${ip.top})`);

            if (rowIndex === colIndex) {
                cellGroup
                    .append("text")
                    .attr("x", cellW / 2)
                    .attr("y", cellH / 2 - 4)
                    .attr("text-anchor", "middle")
                    .style("font-size", "10px")
                    .style("font-weight", "700")
                    .style("fill", "#1a3a8a")
                    .style("pointer-events", "none")
                    .text(colMetric.name);
            } else {
                const valid = data.filter(
                    (row) => Number.isFinite(row[colMetric.key]) && Number.isFinite(row[rowMetric.key])
                );
                if (!valid.length) return;

                const xScale = d3
                    .scaleLinear()
                    .domain(d3.extent(valid, (row) => row[colMetric.key]))
                    .nice()
                    .range([0, innerW]);
                const yScale = d3
                    .scaleLinear()
                    .domain(d3.extent(valid, (row) => row[rowMetric.key]))
                    .nice()
                    .range([innerH, 0]);
                const corr = pearsonR(
                    valid.map((row) => row[colMetric.key]),
                    valid.map((row) => row[rowMetric.key])
                );

                // Add lasso brush in expanded mode only — BEFORE circles so circles sit on top
                // and receive hover events while the brush captures drag in the gaps.
                // D3 function: d3.brush() — creates a 2D rectangular brush (x + y).
                if (isExpanded) {
                    const brush = d3.brush()
                        .extent([[0, 0], [innerW, innerH]])
                        .on("start", function (event) {
                            if (!event.sourceEvent) return; // programmatic call, skip
                            if (scatterLassoLocked) {
                                // A lasso is already active - cancel this new brush
                                d3.select(this).call(brush.move, null);
                                return;
                            }
                            // Clear brushes on all other cells
                            cellBrushes.forEach(({ brushRef, groupRef, ri, ci }) => {
                                if (ri !== rowIndex || ci !== colIndex) {
                                    groupRef.call(brushRef.move, null);
                                }
                            });
                        })
                        .on("end", function (event) {
                            if (!event.sourceEvent) return;
                            if (scatterLassoLocked) return;
                            if (!event.selection) {
                                // Brush cleared (click on empty)
                                scatterLassoSelectedIds.clear();
                                scatterLassoLocked = false;
                                applyScatterLassoStyles(svg.node());
                                // Remove clear button
                                const clearBtn = wrapEl.parentElement?.querySelector(".scatter-lasso-clear-btn");
                                if (clearBtn) clearBtn.remove();
                                return;
                            }
                            const [[x0, y0], [x1, y1]] = event.selection;
                            // Find all points inside the rectangle
                            scatterLassoSelectedIds.clear();
                            valid.forEach((row) => {
                                const cx = xScale(row[colMetric.key]);
                                const cy = yScale(row[rowMetric.key]);
                                if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) {
                                    scatterLassoSelectedIds.add(scatterRowKey(row));
                                }
                            });

                            if (scatterLassoSelectedIds.size > 0) {
                                scatterLassoLocked = true;
                                applyScatterLassoStyles(svg.node());
                                // Show clear button
                                showLassoClearButton(wrapEl, svg.node(), cellBrushes);
                            } else {
                                // Empty selection
                                d3.select(this).call(brush.move, null);
                                applyScatterLassoStyles(svg.node());
                            }
                        });

                    const brushGroup = plotGroup.append("g").attr("class", "sc-lasso-brush").call(brush);
                    cellBrushes.push({ brushRef: brush, groupRef: brushGroup, ri: rowIndex, ci: colIndex });
                }

                // Draw circles AFTER brush so they render on top → hover tooltips work
                plotGroup
                    .selectAll("circle")
                    .data(valid)
                    .enter()
                    .append("circle")
                    .attr("class", "sc-dot")
                    .attr("cx", (row) => xScale(row[colMetric.key]))
                    .attr("cy", (row) => yScale(row[rowMetric.key]))
                    .attr("r", 3)
                    .attr("fill", (row) => GROUP_COLORS[String(row.user_group || "").toLowerCase()] || "#9ca3af")
                    .attr("fill-opacity", 0.5)
                    .attr("stroke", "none")
                    .style("pointer-events", "all")
                    .on("mouseover", (event, row) => {
                        tooltip
                            .style("display", "block")
                            .html(
                                `User ${row.user_id} | Wk ${row.week} | ${row.activity}<br>` +
                                `${colMetric.name}: ${Number.isFinite(row[colMetric.key]) ? row[colMetric.key].toFixed(2) : "N/A"}<br>` +
                                `${rowMetric.name}: ${Number.isFinite(row[rowMetric.key]) ? row[rowMetric.key].toFixed(2) : "N/A"}<br>` +
                                `Group: <em>${row.user_group || "N/A"}</em>`
                            );
                    })
                    .on("mousemove", (event) => {
                        tooltip
                            .style("left", `${event.pageX + 12}px`)
                            .style("top", `${event.pageY - 28}px`);
                    })
                    .on("mouseout", () => tooltip.style("display", "none"));

                cellGroup
                    .append("text")
                    .attr("x", cellW - 3)
                    .attr("y", 10)
                    .attr("text-anchor", "end")
                    .style("font-size", "8px")
                    .style("fill", Math.abs(corr) > 0.5 ? "#c0392b" : "#6b7280")
                    .text(`r=${corr.toFixed(2)}`);
            }

            if (rowIndex === n - 1) {
                cellGroup
                    .append("text")
                    .attr("x", cellW / 2)
                    .attr("y", cellH - 1)
                    .attr("text-anchor", "middle")
                    .style("font-size", "8px")
                    .style("fill", "#6b7280")
                    .text(colMetric.name);
            }
            if (colIndex === 0) {
                cellGroup
                    .append("text")
                    .attr("transform", `translate(9,${cellH / 2}) rotate(-90)`)
                    .attr("text-anchor", "middle")
                    .style("font-size", "8px")
                    .style("fill", "#6b7280")
                    .text(rowMetric.name);
            }
        });
    });
}

// Shows a "Clear selection" button above the scatter matrix when lasso is active.
function showLassoClearButton(wrapEl, svgEl, cellBrushes) {
    const parent = wrapEl.parentElement;
    if (!parent) return;
    // Remove existing button
    const existing = parent.querySelector(".scatter-lasso-clear-btn");
    if (existing) existing.remove();

    const btn = document.createElement("button");
    btn.className = "scatter-lasso-clear-btn";
    btn.type = "button";
    btn.textContent = "Clear selection (" + scatterLassoSelectedIds.size + " points)";
    btn.addEventListener("click", () => {
        scatterLassoSelectedIds.clear();
        scatterLassoLocked = false;
        // Clear all brushes visually
        cellBrushes.forEach(({ brushRef, groupRef }) => {
            groupRef.call(brushRef.move, null);
        });
        applyScatterLassoStyles(svgEl);
        btn.remove();
    });
    // Insert before the svg wrapper
    parent.insertBefore(btn, wrapEl);
}

// Pearson correlation coefficient. Returns 0 if not enough points or no variance.
function pearsonR(xs, ys) {
    const n = xs.length;
    if (n < 2) return 0;
    const mx = d3.mean(xs);
    const my = d3.mean(ys);
    const num = d3.sum(xs.map((x, i) => (x - mx) * (ys[i] - my)));
    const den = Math.sqrt(
        d3.sum(xs.map((x) => (x - mx) ** 2)) * d3.sum(ys.map((y) => (y - my) ** 2))
    );
    return den === 0 ? 0 : num / den;
}

function ensureTooltip() {
    let tooltip = d3.select("#vis-tooltip");
    if (tooltip.empty()) {
        // Single shared tooltip layer used by all researcher visualizations.
        tooltip = d3.select("body").append("div").attr("id", "vis-tooltip").attr("class", "vis-tooltip");
    }
    return tooltip;
}

async function renderDashboard() {
    const rows = await d3.csv(RESEARCHER_DATA_PATH);
    cachedDashboardRows = rows;
    filteredData = rows.slice();

    await renderParallelCoordinatesPlot(cachedDashboardRows);
}

function debounce(fn, waitMs) {
    let timeoutId = null;
    return (...args) => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), waitMs);
    };
}

const modalState = {
    panel: null,
    placeholder: null,
    type: null
};

window.addEventListener("openResearcherModal", (event) => {
    const type = event.detail?.type;
    const modal = document.getElementById("researcher-modal");
    const container = document.getElementById("researcher-modal-container");
    if (!modal || !container) return;

    const panelIdByType = {
        parallel: "parallel-coord-plot",
        line: "line-plot-with-std",
        scatter: "scatter-plot-matrix",
        violin: "violin-plot"
    };
    const panel = document.getElementById(panelIdByType[type]);
    if (!panel) return;

    // Toggle behavior: clicking fullscreen again on the same expanded panel closes it.
    if (modalState.panel === panel && modal.style.display === "flex") {
        closeResearcherModal();
        return;
    }

    closeResearcherModal();
    modal.style.display = "flex";
    container.innerHTML = "";
    const placeholder = document.createElement("div");
    placeholder.className = "modal-plot-placeholder";
    panel.parentNode.insertBefore(placeholder, panel);
    container.appendChild(panel);
    panel.classList.add("modal-plot-live");
    modalState.panel = panel;
    modalState.placeholder = placeholder;
    modalState.type = type;

    // Re-render scatter inside the modal so the lasso brushes are created.
    if (type === "scatter") {
        const dataToUse = filteredData.length ? filteredData : cachedDashboardRows;
        renderScatterPlotMatrix(dataToUse);
    }
});

function closeResearcherModal() {
    const modal = document.getElementById("researcher-modal");
    const container = document.getElementById("researcher-modal-container");
    if (!modal || !container) return;
    const wasScatter = modalState.type === "scatter";
    if (modalState.panel && modalState.placeholder && modalState.placeholder.parentNode) {
        modalState.placeholder.parentNode.insertBefore(modalState.panel, modalState.placeholder);
        modalState.panel.classList.remove("modal-plot-live");
        modalState.placeholder.remove();
    }
    modalState.panel = null;
    modalState.placeholder = null;
    modalState.type = null;
    modal.style.display = "none";
    container.innerHTML = "";

    // Re-render scatter back in normal size (removes lasso brushes).
    if (wasScatter) {
        scatterLassoSelectedIds.clear();
        scatterLassoLocked = false;
        const dataToUse = filteredData.length ? filteredData : cachedDashboardRows;
        renderScatterPlotMatrix(dataToUse);
    }
}

window.closeResearcherModal = closeResearcherModal;

async function init() {
    await loadSharedHeader();
    applyPanelViewportSizing();
    await renderDashboard();
    window.addEventListener("resize", debounce(() => {
        applyPanelViewportSizing();
        renderDashboard();
    }, 120));
}

document.addEventListener("DOMContentLoaded", init);
