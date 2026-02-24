/**
 * VisGait - Researcher View Logic
 */

const RESEARCHER_DATA_PATH = "data/dashboard_data.csv";
let cachedDashboardRows = [];
let filteredData = [];
// Violin filter state
let violinActivity = "All";
let violinGroup = "All";
// Default scatter matrix metric selection shown on first render
let selectedScatterMetricKeys = ["composite_score", "GSI_pct", "step_time_cv_pct", "symmetry_ratio"];
const parallelAxisFilters = {};

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

const METRIC_METADATA = {
    cadence_total_steps_min: { name: "Cadence", unit: "[steps/min]" },
    GSI_pct: { name: "GSI", unit: "[%]" },
    gait_index_left_pct: { name: "GIL", unit: "[%]" },
    gait_index_right_pct: { name: "GIR", unit: "[%]" },
    symmetry_ratio: { name: "Symmetry Ratio", unit: "[-]" },
    step_time_mean_sec: { name: "Step Time Mean", unit: "[s]" },
    cycle_time_mean_sec: { name: "Cycle Time Mean", unit: "[s]" }
};

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

const VIOLIN_METRICS = [
    { key: "GSI_pct_norm", name: "GSI" },
    { key: "symmetry_ratio_norm", name: "Symmetry" },
    { key: "gait_index_left_pct_norm", name: "GI Left" },
    { key: "gait_index_right_pct_norm", name: "GI Right" },
    { key: "step_time_cv_pct_norm", name: "Step CV" },
    { key: "cycle_time_cv_pct_norm", name: "Cycle CV" }
];

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

}

async function syncFilteredDatasetFromParallel(weekData, dimensions) {
    const activeFilterCount = Object.values(parallelAxisFilters).filter((range) => Array.isArray(range) && range.length === 2).length;

    if (!activeFilterCount) {
        filteredData = cachedDashboardRows.slice();
    } else {
        if (Array.isArray(weekData) && weekData.length && weekData[0].__raw) {
            filteredData = weekData
                .filter((row) => rowPassesParallelFilters(row, dimensions))
                .map((row) => row.__raw);
        } else {
            const includedWeeks = new Set(
                weekData
                    .filter((row) => rowPassesParallelFilters(row, dimensions))
                    .map((row) => row.week)
            );

            filteredData = cachedDashboardRows.filter((row) => {
                const week = Number(row.week);
                return Number.isFinite(week) && includedWeeks.has(week);
            });
        }
    }

    updateParallelFilterControls(activeFilterCount, filteredData.length, cachedDashboardRows.length);
    await Promise.all([
        renderLinePlotWithStd(filteredData),
        renderScatterPlotMatrix(filteredData),
        renderViolinPlot(filteredData)
    ]);
}

async function renderParallelCoordinatesPlot(rows) {
    if (!window.d3) {
        console.error("D3 did not load. The parallel coordinates plot cannot render.");
        return;
    }

    const container = d3.select("#parallel-coord-plot");
    container.selectAll("*").remove();

    const controls = container
        .append("div")
        .attr("class", "parallel-filter-controls")
        .attr("id", "parallel-filter-controls");

    controls
        .append("button")
        .attr("type", "button")
        .text("Reset filters")
        .on("click", async () => {
            Object.keys(parallelAxisFilters).forEach((dimension) => delete parallelAxisFilters[dimension]);
            await renderParallelCoordinatesPlot(cachedDashboardRows);
        });

    controls.append("div").attr("class", "parallel-filter-status");

    const hostEl = document.getElementById("parallel-coord-plot");
    if (!hostEl) return;

    const dimensions = PARALLEL_METRICS.map((metric) => metric.name);
    const keyByDimension = PARALLEL_METRICS.reduce((acc, metric) => {
        acc[metric.name] = metric.key;
        return acc;
    }, {});

    const data = rows
        .map((row, index) => {
            const next = { __raw: row, __index: index };
            PARALLEL_METRICS.forEach((metric) => {
                next[metric.name] = Number(row[metric.key]);
            });
            return next;
        })
        .filter((row) => dimensions.filter((dimension) => Number.isFinite(row[dimension])).length >= 2);

    if (!data.length) {
        container.append("div").attr("class", "parallel-empty").text("No numeric data for parallel coordinates.");
        filteredData = cachedDashboardRows.slice();
        updateParallelFilterControls(0, filteredData.length, cachedDashboardRows.length);
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
    const axisSpacing = 140;
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

    const applyLineStyles = () => {
        lineSelection
            .attr("stroke", (row) => (rowPassesParallelFilters(row, dimensions) ? "#2563eb" : "#9ca3af"))
            .attr("stroke-width", (row) => (rowPassesParallelFilters(row, dimensions) ? 1.2 : 1))
            .attr("opacity", (row) => (rowPassesParallelFilters(row, dimensions) ? 0.5 : 0.1));
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
        .text((dimension) => dimension);

    axis
        .append("text")
        .attr("y", plotHeight + PLOT_LAYOUT.parallelAxisBottomLabelOffset)
        .attr("text-anchor", "middle")
        .attr("fill", "#64748b")
        .style("font-size", "11px")
        .text((dimension) => keyByDimension[dimension] || "");

    let isRestoringBrush = false;
    axis.each(function(dimension) {
        const axisGroup = d3.select(this);
        const brush = d3
            .brushY()
            .extent([[-10, 0], [10, plotHeight]])
            .on("brush end", async (event) => {
                if (isRestoringBrush) return;

                if (!event.selection) {
                    delete parallelAxisFilters[dimension];
                } else {
                    const [top, bottom] = event.selection;
                    const max = yByDimension[dimension].invert(top);
                    const min = yByDimension[dimension].invert(bottom);
                    parallelAxisFilters[dimension] = [Math.min(min, max), Math.max(min, max)];
                }

                applyLineStyles();
                await syncFilteredDatasetFromParallel(data, dimensions);
            });

        const brushGroup = axisGroup.append("g").attr("class", "pc-brush").call(brush);
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

// Called on researcher load and checkbox changes:
// builds the metric checkbox panel and draws the scatter matrix from active selections.
async function renderScatterPlotMatrix(rows = []) {
    if (!window.d3) {
        console.error("D3 did not load. The scatter plot cannot render.");
        return;
    }

    const container = d3.select("#scatter-plot-matrix");
    container.selectAll("*").remove();
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
    });

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

    const el = document.getElementById("violin-plot");
    if (!el) return;

    const controls = container.append("div").attr("class", "violin-filters");
    controls.append("label").text("Activity:");
    controls
        .append("select")
        .attr("id", "violin-activity-select")
        .on("change", function() {
            violinActivity = this.value;
            renderViolinPlot(filteredData.length ? filteredData : cachedDashboardRows);
        })
        .selectAll("option")
        .data(["All", "W", "TUG", "STS", "SC"])
        .enter()
        .append("option")
        .attr("value", (d) => d)
        .property("selected", (d) => d === violinActivity)
        .text((d) => d);

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
    if (violinActivity !== "All") {
        filteredRows = filteredRows.filter((row) => String(row.activity || "").toUpperCase() === violinActivity);
    }
    if (violinGroup !== "All") {
        filteredRows = filteredRows.filter((row) => String(row.user_group || "").toLowerCase() === violinGroup);
    }

    const dataByMetric = VIOLIN_METRICS.map(({ key, name }) => ({
        key,
        name,
        values: filteredRows.map((row) => Number(row[key])).filter((v) => Number.isFinite(v))
    })).filter((entry) => entry.values.length > 0);

    const chartWrap = container.append("div").attr("class", "violin-chart-wrap");
    const frame = getPlotFrame("violin-plot", PLOT_LAYOUT.violinControlsHeightRatio);
    if (!frame) return;
    const { width, height, margin, plotWidth, plotHeight } = frame;

    if (!dataByMetric.length) {
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
    const x = d3.scaleBand().domain(dataByMetric.map((d) => d.name)).range([0, plotWidth]).padding(0.3);
    const y = d3.scaleLinear().domain([0, 1]).range([plotHeight, 0]);

    chart.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".1f")));
    chart.append("g").attr("transform", `translate(0,${plotHeight})`).call(d3.axisBottom(x));
    chart
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -plotHeight / 2)
        .attr("y", -38)
        .attr("text-anchor", "middle")
        .style("font-size", "12px")
        .text("Normalized value [0-1]");

    // Bandwidth 0.12 is a tuned default that balances smoothing vs. detail.
    const kde = kernelDensityEstimator(kernelEpanechnikov(0.12), y.ticks(50));

    dataByMetric.forEach(({ name, values }) => {
        const density = kde(values);
        const maxDensity = d3.max(density, (d) => d[1]) || 1;
        const bw = x.bandwidth();
        const xDensity = d3.scaleLinear().domain([-maxDensity, maxDensity]).range([0, bw]);
        const violinG = chart.append("g").attr("transform", `translate(${x(name)},0)`);

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
        const cx = bw / 2;

        violinG
            .append("line")
            .attr("x1", cx)
            .attr("x2", cx)
            .attr("y1", y(wHigh))
            .attr("y2", y(q3))
            .attr("stroke", strokeColor)
            .attr("stroke-width", 1);
        violinG
            .append("line")
            .attr("x1", cx)
            .attr("x2", cx)
            .attr("y1", y(q1))
            .attr("y2", y(wLow))
            .attr("stroke", strokeColor)
            .attr("stroke-width", 1);
        violinG
            .append("rect")
            .attr("x", cx - 5)
            .attr("y", y(q3))
            .attr("width", 10)
            .attr("height", Math.max(1, y(q1) - y(q3)))
            .attr("fill", "#fff")
            .attr("stroke", strokeColor)
            .attr("stroke-width", 1.5);
        violinG
            .append("line")
            .attr("x1", cx - 5)
            .attr("x2", cx + 5)
            .attr("y1", y(median))
            .attr("y2", y(median))
            .attr("stroke", "#e74c3c")
            .attr("stroke-width", 2);

        violinG
            .append("rect")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", bw)
            .attr("height", plotHeight)
            .attr("fill", "transparent")
            .on("mouseover", (event) => {
                const actLabel = violinActivity === "All" ? "All activities" : violinActivity;
                const grpLabel = violinGroup === "All" ? "All groups" : violinGroup;
                tooltip
                    .style("display", "block")
                    .html(
                        `<strong>${name}</strong> - ${actLabel}, ${grpLabel}<br>` +
                        `Median: ${median.toFixed(3)}<br>` +
                        `Q1: ${q1.toFixed(3)} | Q3: ${q3.toFixed(3)}<br>` +
                        `Min: ${d3.min(values).toFixed(3)} | Max: ${d3.max(values).toFixed(3)}<br>` +
                        `n = ${values.length}`
                    );
            })
            .on("mousemove", (event) => {
                tooltip
                    .style("left", `${event.pageX + 12}px`)
                    .style("top", `${event.pageY - 28}px`);
            })
            .on("mouseout", () => tooltip.style("display", "none"));
    });
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
