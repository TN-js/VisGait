/**
 * VisGait - Researcher View Logic
 *
 * Depends on js/config.js being loaded first (GROUP_COLORS, ACTIVITY_METRICS, METRIC_INFO).
 */

const RESEARCHER_DATA_PATH = "data/dashboard_data.csv";
let cachedDashboardRows = [];   // all CSV rows
let activityRows = [];          // rows filtered to selectedActivity
let filteredRows = [];          // activityRows filtered by PCP brushes

// Current activity selection for PCP (drives scatter + violin too)
let selectedActivity = "W";

// Violin filter state
let violinGroup = "All";
let violinMetricKey = "";       // set dynamically on activity change

// Scatter metric selection - rebuilt on activity change
let selectedScatterMetricKeys = [];

// PCP brush state
const parallelAxisFilters = {};
let parallelBrushHistory = [];

// For finetuning sizings of the plot layout
const PLOT_LAYOUT = {
    marginRatio: { top: 0.07, right: 0.05, bottom: 0.11, left: 0.1 },
    parallelMarginRatio: { top: 0.1, right: 0.04, bottom: 0.16, left: 0.03 },
    parallelAxisPadding: 0.08,
    parallelAxisTopLabelOffset: -12,
    parallelAxisBottomLabelOffset: 24,
    parallelControlsHeightRatio: 0.14,
    violinControlsHeightRatio: 0.14
};

// ─── Metric Info Tooltip Helper ──────────────────────────────────────────
function showMetricInfoTooltip(event, metricKey) {
    const tip = document.getElementById("metric-info-tooltip");
    if (!tip) return;
    const text = getMetricTooltip(metricKey);
    tip.textContent = text;
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

// ─── Activity Change Handler ────────────────────────────────────────────
// Called when PCP activity dropdown changes. Rebuilds all panels.
async function onActivityChange(newActivity) {
    selectedActivity = newActivity;

    // Filter CSV to selected activity
    activityRows = cachedDashboardRows.filter(
        (row) => String(row.activity || "").trim().toUpperCase() === selectedActivity
    );

    // Clear PCP brushes
    Object.keys(parallelAxisFilters).forEach((k) => delete parallelAxisFilters[k]);
    parallelBrushHistory = [];

    // Reset filtered to all activity rows (no brushes active)
    filteredRows = activityRows.slice();

    // Rebuild scatter metric checkboxes for this activity
    const metrics = ACTIVITY_METRICS[selectedActivity] || [];
    selectedScatterMetricKeys = metrics.slice(0, 4);

    // Reset violin metric to first available
    violinMetricKey = metrics.length > 0 ? metrics[0] : "";

    // Rebuild all panels
    await renderParallelCoordinatesPlot(activityRows);
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

// Checks if a row passes all active PCP brush filters
function rowPassesParallelFilters(row, dimensions) {
    for (const dim of dimensions) {
        const range = parallelAxisFilters[dim];
        if (!range) continue;
        const value = Number(row[dim]);
        if (!Number.isFinite(value) || value < range[0] || value > range[1]) {
            return false;
        }
    }
    return true;
}

function updateParallelFilterControls(activeFilterCount, filteredCount, totalCount) {
    const controlsEl = document.getElementById("parallel-filter-controls");
    if (!controlsEl) return;

    const statusEl = controlsEl.querySelector(".parallel-filter-status");
    if (statusEl) {
        if (activeFilterCount > 0) {
            statusEl.textContent = `${filteredCount}/${totalCount} rows in filter`;
        } else {
            statusEl.textContent = `No active filters (${totalCount} rows)`;
        }
    }

    const undoBtn = controlsEl.querySelector("#parallel-undo-filters");
    if (undoBtn) {
        undoBtn.disabled = parallelBrushHistory.length === 0;
    }
}

// Sync filtered data from PCP brushes → scatter, violin, line plot
async function syncFilteredDatasetFromParallel(dimensions) {
    const activeFilterCount = Object.values(parallelAxisFilters)
        .filter((range) => Array.isArray(range) && range.length === 2).length;

    if (!activeFilterCount) {
        filteredRows = activityRows.slice();
    } else {
        filteredRows = activityRows.filter((row) => rowPassesParallelFilters(row, dimensions));
    }

    updateParallelFilterControls(activeFilterCount, filteredRows.length, activityRows.length);

    await Promise.all([
        renderLinePlotWithStd(cachedDashboardRows),
        renderScatterPlotMatrix(filteredRows),
        renderViolinPlot(filteredRows)
    ]);
}

// ─── Parallel Coordinates Plot (Activity-First) ─────────────────────────
// Each line = one CSV row (one user × one week for selected activity).
// Axes = ACTIVITY_METRICS[selectedActivity]. Colored by user_group.
async function renderParallelCoordinatesPlot(rows) {
    if (!window.d3) {
        console.error("D3 did not load. The parallel coordinates plot cannot render.");
        return;
    }

    const container = d3.select("#parallel-coord-plot");
    container.selectAll("*").remove();

    const hostEl = document.getElementById("parallel-coord-plot");
    if (!hostEl) return;

    // ── Activity dropdown + legend bar ──
    const controlsBar = container.append("div").attr("class", "pcp-controls-bar");
    controlsBar.append("label").text("Activity:");
    controlsBar
        .append("select")
        .attr("id", "pcp-activity-select")
        .on("change", function () {
            onActivityChange(this.value);
        })
        .selectAll("option")
        .data(["W", "TUG", "SC", "STS"])
        .enter()
        .append("option")
        .attr("value", (d) => d)
        .property("selected", (d) => d === selectedActivity)
        .text((d) => d);

    // Legend
    const legend = controlsBar.append("div").attr("class", "pcp-legend");
    Object.entries(GROUP_COLORS).forEach(([group, color]) => {
        const item = legend.append("span").attr("class", "pcp-legend-item");
        item.append("span")
            .attr("class", "pcp-legend-swatch")
            .style("background", color);
        item.append("span").text(group.charAt(0).toUpperCase() + group.slice(1));
    });

    // ── Dimensions = metric columns for this activity ──
    const dimensions = (ACTIVITY_METRICS[selectedActivity] || []).slice();

    // Parse numeric values from rows
    const data = rows
        .map((row) => {
            const parsed = { __raw: row };
            parsed.user_id = row.user_id;
            parsed.week = row.week;
            parsed.user_group = String(row.user_group || "").toLowerCase();
            dimensions.forEach((dim) => {
                parsed[dim] = Number(row[dim]);
            });
            return parsed;
        })
        .filter((row) => dimensions.filter((dim) => Number.isFinite(row[dim])).length >= 2);

    let isRestoringBrush = false;
    const brushesByDim = {};
    let applyLineStyles = () => {};

    // ── Filter controls (Reset / Undo / Status) ──
    const controls = container
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
            Object.keys(parallelAxisFilters).forEach((dim) => {
                delete parallelAxisFilters[dim];
                if (brushesByDim[dim]) {
                    brushesByDim[dim].group.call(brushesByDim[dim].brush.move, null);
                }
            });
            isRestoringBrush = false;

            applyLineStyles();
            await syncFilteredDatasetFromParallel(dimensions);
        });

    controls
        .append("button")
        .attr("type", "button")
        .attr("id", "parallel-undo-filters")
        .text("Undo")
        .property("disabled", true)
        .on("click", async () => {
            while (parallelBrushHistory.length > 0) {
                const lastDim = parallelBrushHistory.pop();
                if (parallelAxisFilters[lastDim]) {
                    delete parallelAxisFilters[lastDim];

                    isRestoringBrush = true;
                    if (brushesByDim[lastDim]) {
                        brushesByDim[lastDim].group.call(brushesByDim[lastDim].brush.move, null);
                    }
                    isRestoringBrush = false;

                    applyLineStyles();
                    await syncFilteredDatasetFromParallel(dimensions);
                    return;
                }
            }
        });

    controls.append("div").attr("class", "parallel-filter-status");

    if (!data.length) {
        container.append("div").attr("class", "parallel-empty").text("No data for this activity.");
        filteredRows = activityRows.slice();
        updateParallelFilterControls(0, filteredRows.length, activityRows.length);
        await Promise.all([
            renderLinePlotWithStd(cachedDashboardRows),
            renderScatterPlotMatrix(filteredRows),
            renderViolinPlot(filteredRows)
        ]);
        return;
    }

    // ── SVG sizing ──
    const panelWidth = Math.max(320, hostEl.clientWidth || 0);
    const panelHeight = Math.max(240, hostEl.clientHeight || 0);
    const controlsHeight = panelHeight * PLOT_LAYOUT.parallelControlsHeightRatio;
    const viewportHeight = Math.max(160, panelHeight - controlsHeight - 40);
    const axisSpacing = dimensions.length > 14 ? 120 : 150;
    const chartWidth = Math.max(panelWidth - 20, axisSpacing * (dimensions.length - 1) + 130);
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

    // Horizontal drag scroll
    let isDragging = false;
    let dragStartX = 0;
    let dragStartScroll = 0;
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
            scrollWrap.node().scrollLeft = dragStartScroll - (event.clientX - dragStartX);
        })
        .on("mouseup", () => { isDragging = false; })
        .on("mouseleave", () => { isDragging = false; });

    const chart = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const x = d3.scalePoint().domain(dimensions).range([0, plotWidth]).padding(PLOT_LAYOUT.parallelAxisPadding);

    // ── One vertical scale per axis ──
    const yByDim = {};
    dimensions.forEach((dim) => {
        const values = data.map((row) => row[dim]).filter(Number.isFinite);
        const extent = d3.extent(values);
        if (!values.length || !Number.isFinite(extent[0]) || !Number.isFinite(extent[1])) {
            yByDim[dim] = d3.scaleLinear().domain([0, 1]).range([plotHeight, 0]);
            return;
        }
        yByDim[dim] = d3
            .scaleLinear()
            .domain(extent[0] === extent[1] ? [extent[0] - 1, extent[1] + 1] : extent)
            .nice()
            .range([plotHeight, 0]);
    });

    // ── Line generator ──
    const line = d3
        .line()
        .defined(([, val]) => Number.isFinite(val))
        .x(([dim]) => x(dim))
        .y(([dim, val]) => yByDim[dim](val));

    // ── Draw polylines (colored by user_group) ──
    const lineSelection = chart
        .selectAll(".pc-line")
        .data(data)
        .enter()
        .append("path")
        .attr("class", "pc-line")
        .attr("fill", "none")
        .attr("d", (row) => line(dimensions.map((dim) => [dim, row[dim]])));

    applyLineStyles = () => {
        lineSelection
            .attr("stroke", (row) => {
                if (!rowPassesParallelFilters(row, dimensions)) return "#d1d5db";
                return GROUP_COLORS[row.user_group] || "#94a3b8";
            })
            .attr("stroke-width", (row) => (rowPassesParallelFilters(row, dimensions) ? 1.4 : 0.8))
            .attr("opacity", (row) => (rowPassesParallelFilters(row, dimensions) ? 0.55 : 0.06));
    };

    // ── Axes ──
    const tooltip = ensureTooltip();
    const axisGroups = chart
        .selectAll(".pc-axis")
        .data(dimensions)
        .enter()
        .append("g")
        .attr("class", "pc-axis")
        .attr("transform", (dim) => `translate(${x(dim)},0)`)
        .each(function (dim) {
            d3.select(this).call(d3.axisLeft(yByDim[dim]).ticks(5));
        });

    // ── Axis labels (with metric info tooltip on hover) ──
    axisGroups
        .append("text")
        .attr("y", PLOT_LAYOUT.parallelAxisTopLabelOffset)
        .attr("text-anchor", "middle")
        .attr("fill", "#111")
        .style("font-size", "10px")
        .style("cursor", "help")
        .text((dim) => dim)
        .on("mouseover", function (event, dim) { showMetricInfoTooltip(event, dim); })
        .on("mousemove", function (event) { moveMetricInfoTooltip(event); })
        .on("mouseout", function () { hideMetricInfoTooltip(); });

    // ── Brushes ──
    axisGroups.each(function (dim) {
        const axisGroup = d3.select(this);
        const brush = d3
            .brushY()
            .extent([[-10, 0], [10, plotHeight]])
            .on("brush end", async (event) => {
                if (isRestoringBrush) return;

                if (!event.selection) {
                    delete parallelAxisFilters[dim];
                    parallelBrushHistory = parallelBrushHistory.filter((d) => d !== dim);
                } else {
                    const [top, bottom] = event.selection;
                    const max = yByDim[dim].invert(top);
                    const min = yByDim[dim].invert(bottom);
                    parallelAxisFilters[dim] = [Math.min(min, max), Math.max(min, max)];
                    parallelBrushHistory = parallelBrushHistory.filter((d) => d !== dim);
                    parallelBrushHistory.push(dim);
                }

                applyLineStyles();
                await syncFilteredDatasetFromParallel(dimensions);
            });

        const brushGroup = axisGroup.append("g").attr("class", "pc-brush").call(brush);
        brushesByDim[dim] = { brush, group: brushGroup };

        const range = parallelAxisFilters[dim];
        if (range) {
            isRestoringBrush = true;
            brushGroup.call(brush.move, [yByDim[dim](range[1]), yByDim[dim](range[0])]);
            isRestoringBrush = false;
        }
    });

    applyLineStyles();
    await syncFilteredDatasetFromParallel(dimensions);
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

    const frame = getPlotFrame("line-plot-with-std");
    if (!frame) return;
    const { width, height, margin, plotWidth, plotHeight } = frame;

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
    const weekMap = new Map();
    byWeekActivity.forEach((entry) => {
        if (!weekMap.has(entry.week)) weekMap.set(entry.week, { week: entry.week });
        const target = weekMap.get(entry.week);
        const prefix = entry.activity === "TUG" ? "TUG" : "W";
        const mean = (arr) => (arr.length ? d3.mean(arr) : NaN);

        maxWeek = Math.max(maxWeek, entry.week);
        minWeek = Math.min(minWeek, entry.week);

        target[`GSI-${prefix}`] = mean(entry.gsi);
        target[`GIR-${prefix}`] = mean(entry.gir);
        target[`GIL-${prefix}`] = mean(entry.gil);
        target[`GSI-${prefix}-STD`] = getStandardDeviation(entry.gsi);
        target[`GIR-${prefix}-STD`] = getStandardDeviation(entry.gir);
        target[`GIL-${prefix}-STD`] = getStandardDeviation(entry.gil);
    });

    const dimensions = ["GSI-TUG", "GSI-W", "GIR-TUG", "GIL-TUG", "GIR-W", "GIL-W"];
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
        .filter((row) => dimensions.every((dimension) => Number.isFinite(row[dimension])))
        .sort((a, b) => a.week - b.week);

    if (!data.length || !Number.isFinite(minWeek) || !Number.isFinite(maxWeek)) {
        container.text("No line chart data available.");
        return;
    }

    const svg = container
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    const chart = svg
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const y = d3.scaleLinear().range([plotHeight, 0]);
    const x = d3.scaleLinear().range([0, plotWidth]);

    x.domain([minWeek, maxWeek]);
    y.domain([-5, 50]);

    chart.append("g").call(d3.axisLeft(y));
    chart
        .append("g")
        .attr("transform", `translate(0,${plotHeight})`)
        .call(d3.axisBottom(x));

    const tooltip = d3.select("body")
        .append("div")
        .style("position", "absolute")
        .style("opacity", 0);

    const color = d3.scaleOrdinal(d3.schemeCategory10);

    dimensions.forEach((dimension) => {
        const lineGroup = chart.append("g");

        const areaToShade = d3
            .area()
            .x((d) => x(d.week))
            .y0((d) => y(d[dimension] - d[`${dimension}-STD`]))
            .y1((d) => y(d[dimension] + d[`${dimension}-STD`]));
        lineGroup
            .append("path")
            .datum(data)
            .attr("fill", color(dimension))
            .attr("opacity", 0.5)
            .attr("d", areaToShade);
    })

    dimensions.forEach((dimension) => {
        const lineGroup = chart.append("g");
        const line = d3
            .line()
            .x((d) => x(d.week))
            .y((d) => y(d[dimension]));

        lineGroup
            .append("path")
            .datum(data)
            .attr("fill", "none")
            .attr("stroke", color(dimension))
            .attr("stroke-width", 1)
            .attr("d", line);

        lineGroup.selectAll("circle").data(data).enter().append("circle")
        .attr("cx", d => x(d.week)).attr("cy", d => y(d[dimension])).attr("r", 3)
        .style('cursor','pointer')
        .on('mouseover', (e, d) => {
            // use dark tooltip style for line chart
            tooltip.style('background', '#1e293b').style('color', '#ffffff').style('padding', '8px 10px').style('border', 'none').style('min-width','60px');
            const wk = d && d.week ? d.week : '?';
            const value = d[dimension];
            const stdValue = d[`${dimension}-STD`];
            tooltip.style('opacity', 1).html(`Week: ${wk}<br/>${dimension}: ${value}<br/>${dimension}-STD: ${stdValue}`)
                .style('left', (e.pageX + 10) + 'px').style('top', (e.pageY + 10) + 'px');
        })
        .on('mousemove', (e) => {
            tooltip.style('left', (e.pageX + 10) + 'px').style('top', (e.pageY + 10) + 'px');
        })
        .on('mouseout', () => { tooltip.style('opacity', 0); });
    });
    chart.selectAll("circle").raise()
}

// ─── Scatter Plot Matrix (activity-aware) ───────────────────────────────
// Metrics come from ACTIVITY_METRICS[selectedActivity].
async function renderScatterPlotMatrix(rows = []) {
    if (!window.d3) {
        console.error("D3 did not load. The scatter plot cannot render.");
        return;
    }

    const container = d3.select("#scatter-plot-matrix");
    container.selectAll("*").remove();
    const hostEl = document.getElementById("scatter-plot-matrix");
    if (!hostEl) return;

    // Preserve the expand button
    if (!hostEl.querySelector(".enlarge-btn")) {
        const btn = document.createElement("button");
        btn.className = "enlarge-btn";
        btn.textContent = "⛶";
        btn.onclick = () => openResearcherModal("scatter");
        hostEl.appendChild(btn);
    }

    // Build metric list from current activity
    const activityMetricKeys = ACTIVITY_METRICS[selectedActivity] || [];
    const SCATTER_METRICS = activityMetricKeys.map((key) => ({ key, name: key }));

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

    // Keep selected keys that are still valid for this activity
    selectedScatterMetricKeys = selectedScatterMetricKeys.filter((key) =>
        availableMetrics.some((metric) => metric.key === key)
    );
    if (selectedScatterMetricKeys.length < 2) {
        selectedScatterMetricKeys = availableMetrics.slice(0, 4).map((metric) => metric.key);
        if (selectedScatterMetricKeys.length < 2) {
            selectedScatterMetricKeys = availableMetrics.slice(0, 2).map((metric) => metric.key);
        }
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
        label.append("span")
            .text(metric.name)
            .style("cursor", "help")
            .on("mouseover", (event) => showMetricInfoTooltip(event, metric.key))
            .on("mousemove", (event) => moveMetricInfoTooltip(event))
            .on("mouseout", () => hideMetricInfoTooltip());
    });

    redraw();
}

// ─── Violin Plot (activity-aware, single metric) ────────────────────────
// Follows PCP activity selection. User picks ONE metric + optional group filter.
async function renderViolinPlot(rows) {
    if (!window.d3) {
        console.error("D3 did not load. The violin plot cannot render.");
        return;
    }

    const container = d3.select("#violin-plot");
    container.selectAll("*").remove();

    const el = document.getElementById("violin-plot");
    if (!el) return;

    // Preserve expand button
    if (!el.querySelector(".enlarge-btn")) {
        const btn = document.createElement("button");
        btn.className = "enlarge-btn";
        btn.textContent = "⛶";
        btn.onclick = () => openResearcherModal("violin");
        el.appendChild(btn);
    }

    // Build metric list from current activity
    const activityMetricKeys = ACTIVITY_METRICS[selectedActivity] || [];
    if (!violinMetricKey || !activityMetricKeys.includes(violinMetricKey)) {
        violinMetricKey = activityMetricKeys.length > 0 ? activityMetricKeys[0] : "";
    }

    const controls = container.append("div").attr("class", "violin-filters");

    // Metric dropdown
    controls.append("label").text("Metric:");
    const metricSelect = controls
        .append("select")
        .attr("id", "violin-metric-select")
        .on("change", function () {
            violinMetricKey = this.value;
            renderViolinPlot(filteredRows.length ? filteredRows : activityRows);
        });
    activityMetricKeys.forEach((key) => {
        metricSelect.append("option")
            .attr("value", key)
            .property("selected", key === violinMetricKey)
            .text(key);
    });

    // Group dropdown
    controls.append("label").text("Group:");
    controls
        .append("select")
        .attr("id", "violin-group-select")
        .on("change", function() {
            violinGroup = this.value;
            renderViolinPlot(filteredRows.length ? filteredRows : activityRows);
        })
        .selectAll("option")
        .data(["All", "improving", "declining", "stable"])
        .enter()
        .append("option")
        .attr("value", (d) => d)
        .property("selected", (d) => d === violinGroup)
        .text((d) => (d === "All" ? "All" : d.charAt(0).toUpperCase() + d.slice(1)));

    // Activity label (read-only - driven by PCP)
    controls.append("span")
        .style("margin-left", "auto")
        .style("color", "#94a3b8")
        .style("font-size", "11px")
        .text(`Activity: ${selectedActivity}`);

    // Filter by group
    let violinRows = rows;
    if (violinGroup !== "All") {
        violinRows = violinRows.filter((row) => String(row.user_group || "").toLowerCase() === violinGroup);
    }

    if (!violinMetricKey) {
        container.append("div").attr("class", "violin-empty").text("No metric selected.");
        return;
    }

    // Extract values for the selected metric
    const values = violinRows
        .map((row) => Number(row[violinMetricKey]))
        .filter((v) => Number.isFinite(v));

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

    // Y scale auto-fits to data
    const yExtent = d3.extent(values);
    const yPad = (yExtent[1] - yExtent[0]) * 0.1 || 1;
    const y = d3.scaleLinear().domain([yExtent[0] - yPad, yExtent[1] + yPad]).nice().range([plotHeight, 0]);

    chart.append("g").call(d3.axisLeft(y).ticks(6));

    // Metric label on y-axis (with tooltip)
    chart.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -plotHeight / 2)
        .attr("y", -38)
        .attr("text-anchor", "middle")
        .style("font-size", "12px")
        .style("cursor", "help")
        .text(violinMetricKey)
        .on("mouseover", (event) => showMetricInfoTooltip(event, violinMetricKey))
        .on("mousemove", (event) => moveMetricInfoTooltip(event))
        .on("mouseout", () => hideMetricInfoTooltip());

    // KDE bandwidth scaled to data range
    const dataRange = yExtent[1] - yExtent[0];
    const bandwidth = Math.max(0.01, dataRange * 0.08);
    const kde = kernelDensityEstimator(kernelEpanechnikov(bandwidth), y.ticks(50));
    const density = kde(values);
    const maxDensity = d3.max(density, (d) => d[1]) || 1;
    const violinWidth = plotWidth * 0.6;
    const xDensity = d3.scaleLinear().domain([-maxDensity, maxDensity]).range([0, violinWidth]);
    const cx = plotWidth / 2;
    const violinG = chart.append("g").attr("transform", `translate(${cx - violinWidth / 2},0)`);

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

    // Box plot overlay
    const sorted = values.slice().sort(d3.ascending);
    const q1 = d3.quantile(sorted, 0.25);
    const median = d3.quantile(sorted, 0.5);
    const q3 = d3.quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const wLow = Math.max(d3.min(values), q1 - 1.5 * iqr);
    const wHigh = Math.min(d3.max(values), q3 + 1.5 * iqr);
    const boxCx = violinWidth / 2;

    violinG.append("line").attr("x1", boxCx).attr("x2", boxCx).attr("y1", y(wHigh)).attr("y2", y(q3)).attr("stroke", strokeColor).attr("stroke-width", 1);
    violinG.append("line").attr("x1", boxCx).attr("x2", boxCx).attr("y1", y(q1)).attr("y2", y(wLow)).attr("stroke", strokeColor).attr("stroke-width", 1);
    violinG.append("rect").attr("x", boxCx - 8).attr("y", y(q3)).attr("width", 16).attr("height", Math.max(1, y(q1) - y(q3))).attr("fill", "#fff").attr("stroke", strokeColor).attr("stroke-width", 1.5);
    violinG.append("line").attr("x1", boxCx - 8).attr("x2", boxCx + 8).attr("y1", y(median)).attr("y2", y(median)).attr("stroke", "#e74c3c").attr("stroke-width", 2);

    // Hover overlay
    violinG
        .append("rect")
        .attr("x", 0).attr("y", 0).attr("width", violinWidth).attr("height", plotHeight)
        .attr("fill", "transparent")
        .on("mouseover", (event) => {
            const grpLabel = violinGroup === "All" ? "All groups" : violinGroup;
            tooltip
                .style("display", "block")
                .html(
                    `<strong>${violinMetricKey}</strong> - ${selectedActivity}, ${grpLabel}<br>` +
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

// D3 renderer for scatter matrix SVG.
// Receives parsed rows, active metrics, and the wrapper element to draw into.
function drawScatterMatrixSvg(data, metrics, wrapEl) {
    if (!wrapEl) return;
    wrapEl.innerHTML = "";

    const n = metrics.length;
    if (n < 2) return;

    const totalWidth = Math.max(1, wrapEl.clientWidth);
    const totalHeight = Math.max(1, wrapEl.clientHeight);
    const gap = 3;
    const cellW = Math.floor((totalWidth - gap * (n + 1)) / n);
    const cellH = Math.floor((totalHeight - gap * (n + 1)) / n);
    const ip = { top: 14, right: 4, bottom: 14, left: 20 };
    const innerW = cellW - ip.left - ip.right;
    const innerH = cellH - ip.top - ip.bottom;

    const svg = d3
        .select(wrapEl)
        .append("svg")
        .attr("viewBox", `0 0 ${totalWidth} ${totalHeight}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .style("width", "100%")
        .style("height", "100%");

    const tooltip = ensureTooltip();

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

                plotGroup
                    .selectAll("circle")
                    .data(valid)
                    .enter()
                    .append("circle")
                    .attr("cx", (row) => xScale(row[colMetric.key]))
                    .attr("cy", (row) => yScale(row[rowMetric.key]))
                    .attr("r", 2)
                    .attr("fill", (row) => GROUP_COLORS[String(row.user_group || "").toLowerCase()] || "#9ca3af")
                    .attr("fill-opacity", 0.5)
                    .attr("stroke", "none")
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

    // Initialize with default activity
    activityRows = rows.filter(
        (row) => String(row.activity || "").trim().toUpperCase() === selectedActivity
    );
    filteredRows = activityRows.slice();

    // Set initial scatter + violin selections for the default activity
    const metrics = ACTIVITY_METRICS[selectedActivity] || [];
    selectedScatterMetricKeys = metrics.slice(0, 4);
    violinMetricKey = metrics.length > 0 ? metrics[0] : "";

    await renderParallelCoordinatesPlot(activityRows);
}

function debounce(fn, waitMs) {
    let timeoutId = null;
    return (...args) => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), waitMs);
    };
}

// ─── Expand / Modal Handler ─────────────────────────────────────────────
window.addEventListener("openResearcherModal", (e) => {
    const { type } = e.detail;
    const modal = document.getElementById("researcher-modal");
    const container = document.getElementById("researcher-modal-container");
    const title = document.getElementById("researcher-modal-title");
    if (!modal || !container) return;

    modal.style.display = "flex";
    container.innerHTML = "";

    const dataToUse = filteredRows.length ? filteredRows : activityRows;

    if (type === "scatter") {
        title.textContent = "Scatter Plot Matrix - Detailed View";
        renderScatterInContainer(dataToUse, container, 800, 700);
    } else if (type === "violin") {
        title.textContent = "Violin Plot - Detailed View";
        renderViolinInContainer(dataToUse, container, 900, 550);
    }
});

// ─── Modal renderers (enlarged versions) ────────────────────────────────
function renderScatterInContainer(rows, containerEl, w, h) {
    const container = d3.select(containerEl);
    container.html("");
    const actMetrics = ACTIVITY_METRICS[selectedActivity] || [];
    const activeMetrics = actMetrics
        .filter((key) => selectedScatterMetricKeys.includes(key))
        .map((key) => ({ key, name: key }));
    if (activeMetrics.length < 2) {
        container.append("div").text("Select at least 2 metrics.").style("color", "#94a3b8").style("padding", "20px");
        return;
    }
    const parsedRows = rows.map((row) => {
        const next = { user_id: row.user_id, week: row.week, activity: row.activity, user_group: row.user_group };
        activeMetrics.forEach((m) => { next[m.key] = Number(row[m.key]); });
        return next;
    });
    // Use the container's actual available space so the matrix fits inside the modal
    const availW = containerEl.clientWidth || w;
    const availH = containerEl.clientHeight || h;
    const side = Math.min(availW, availH);
    const wrapEl = container.append("div")
        .style("width", `${side}px`)
        .style("height", `${side}px`)
        .node();
    drawScatterMatrixSvg(parsedRows, activeMetrics, wrapEl);
}

function renderViolinInContainer(rows, containerEl, w, h) {
    const container = d3.select(containerEl);
    container.html("");
    if (!violinMetricKey) { container.append("div").text("No metric selected."); return; }

    let violinRows = rows;
    if (violinGroup !== "All") {
        violinRows = violinRows.filter((row) => String(row.user_group || "").toLowerCase() === violinGroup);
    }
    const values = violinRows.map((row) => Number(row[violinMetricKey])).filter(Number.isFinite);
    if (!values.length) { container.append("div").text("No data."); return; }

    const margin = { top: 30, right: 40, bottom: 50, left: 60 };
    const plotWidth = w - margin.left - margin.right;
    const plotHeight = h - margin.top - margin.bottom;

    const svg = container.append("svg").attr("width", w).attr("height", h);
    const chart = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const yExtent = d3.extent(values);
    const yPad = (yExtent[1] - yExtent[0]) * 0.1 || 1;
    const y = d3.scaleLinear().domain([yExtent[0] - yPad, yExtent[1] + yPad]).nice().range([plotHeight, 0]);
    chart.append("g").call(d3.axisLeft(y).ticks(8));
    chart.append("text").attr("transform", "rotate(-90)").attr("x", -plotHeight / 2).attr("y", -45).attr("text-anchor", "middle").style("font-size", "13px").text(violinMetricKey);

    const dataRange = yExtent[1] - yExtent[0];
    const bandwidth = Math.max(0.01, dataRange * 0.08);
    const kde = kernelDensityEstimator(kernelEpanechnikov(bandwidth), y.ticks(60));
    const density = kde(values);
    const maxDensity = d3.max(density, (d) => d[1]) || 1;
    const violinWidth = plotWidth * 0.5;
    const xDensity = d3.scaleLinear().domain([-maxDensity, maxDensity]).range([0, violinWidth]);
    const violinG = chart.append("g").attr("transform", `translate(${plotWidth / 2 - violinWidth / 2},0)`);

    const fillColor = violinGroup !== "All" ? (GROUP_COLORS[violinGroup] || "#83b2ff") : "#83b2ff";
    violinG.append("path").datum(density)
        .attr("fill", fillColor).attr("fill-opacity", 0.65).attr("stroke", "#1a3a8a").attr("stroke-width", 1)
        .attr("d", d3.area().x0((d) => xDensity(-d[1])).x1((d) => xDensity(d[1])).y((d) => y(d[0])).curve(d3.curveCatmullRom));

    const sorted = values.slice().sort(d3.ascending);
    const q1 = d3.quantile(sorted, 0.25), median = d3.quantile(sorted, 0.5), q3 = d3.quantile(sorted, 0.75);
    const iqr = q3 - q1, wLow = Math.max(d3.min(values), q1 - 1.5 * iqr), wHigh = Math.min(d3.max(values), q3 + 1.5 * iqr);
    const boxCx = violinWidth / 2;
    violinG.append("line").attr("x1", boxCx).attr("x2", boxCx).attr("y1", y(wHigh)).attr("y2", y(q3)).attr("stroke", "#1a3a8a");
    violinG.append("line").attr("x1", boxCx).attr("x2", boxCx).attr("y1", y(q1)).attr("y2", y(wLow)).attr("stroke", "#1a3a8a");
    violinG.append("rect").attr("x", boxCx - 10).attr("y", y(q3)).attr("width", 20).attr("height", Math.max(1, y(q1) - y(q3))).attr("fill", "#fff").attr("stroke", "#1a3a8a").attr("stroke-width", 1.5);
    violinG.append("line").attr("x1", boxCx - 10).attr("x2", boxCx + 10).attr("y1", y(median)).attr("y2", y(median)).attr("stroke", "#e74c3c").attr("stroke-width", 2);
}

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