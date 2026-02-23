/**
 * VisGait - Researcher View Logic
 */

const RESEARCHER_DATA_PATH = "data/dashboard_data.csv";
let cachedDashboardRows = [];
let filteredData = [];
let selectedViolinMetricKey = "cadence_total_steps_min";
const parallelAxisFilters = {};

const PLOT_LAYOUT = {
    panelWidthVw: 44,
    panelHeightVh: 36,
    marginRatio: { top: 0.07, right: 0.05, bottom: 0.11, left: 0.1 },
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
        el.style.width = `${PLOT_LAYOUT.panelWidthVw}vw`;
        el.style.height = `${PLOT_LAYOUT.panelHeightVh}vh`;
    });
}

function getPlotFrame(panelId, reserveTopRatio = 0) {
    const el = document.getElementById(panelId);
    if (!el) return null;

    const width = el.clientWidth || (window.innerWidth * PLOT_LAYOUT.panelWidthVw) / 100;
    const totalHeight = el.clientHeight || (window.innerHeight * PLOT_LAYOUT.panelHeightVh) / 100;
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

    updateParallelFilterControls(activeFilterCount, filteredData.length, cachedDashboardRows.length);
    await Promise.all([
        renderLinePlotWithStd(filteredData),
        renderScatterPlotMatrix(filteredData)
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

    const frame = getPlotFrame("parallel-coord-plot", PLOT_LAYOUT.parallelControlsHeightRatio);
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
                gil: [],
                cadence: [],
                symmetry: []
            });
        }

        const bucket = byWeekActivity.get(key);
        const gsi = Number(row.GSI_pct);
        const gir = Number(row.gait_index_right_pct);
        const gil = Number(row.gait_index_left_pct);
        const cadence = Number(row.cadence_total_steps_min);
        const symmetry = Number(row.symmetry_ratio);

        if (Number.isFinite(gsi)) bucket.gsi.push(gsi);
        if (Number.isFinite(gir)) bucket.gir.push(gir);
        if (Number.isFinite(gil)) bucket.gil.push(gil);
        if (Number.isFinite(cadence)) bucket.cadence.push(cadence);
        if (Number.isFinite(symmetry)) bucket.symmetry.push(symmetry);
    });

    const dimensions = [
        "GSI-TUG",
        "GSI-W",
        "GIR-TUG",
        "GIL-TUG",
        "GIR-W",
        "GIL-W",
        "Cadence",
        "Symmetry Ratio"
    ];

    const weekMap = new Map();
    byWeekActivity.forEach((entry) => {
        if (!weekMap.has(entry.week)) weekMap.set(entry.week, { week: entry.week });
        const target = weekMap.get(entry.week);
        const prefix = entry.activity === "TUG" ? "TUG" : "W";
        const mean = (arr) => (arr.length ? d3.mean(arr) : NaN);

        target[`GSI-${prefix}`] = mean(entry.gsi);
        target[`GIR-${prefix}`] = mean(entry.gir);
        target[`GIL-${prefix}`] = mean(entry.gil);
        target[`Cadence-${prefix}`] = mean(entry.cadence);
        target[`Symmetry-${prefix}`] = mean(entry.symmetry);
    });

    const data = Array.from(weekMap.values())
        .map((row) => ({
            week: row.week,
            "GSI-TUG": row["GSI-TUG"],
            "GSI-W": row["GSI-W"],
            "GIR-TUG": row["GIR-TUG"],
            "GIL-TUG": row["GIL-TUG"],
            "GIR-W": row["GIR-W"],
            "GIL-W": row["GIL-W"],
            Cadence: d3.mean([row["Cadence-TUG"], row["Cadence-W"]].filter(Number.isFinite)),
            "Symmetry Ratio": d3.mean([row["Symmetry-TUG"], row["Symmetry-W"]].filter(Number.isFinite))
        }))
        .filter((row) => dimensions.every((dimension) => Number.isFinite(row[dimension])))
        .sort((a, b) => a.week - b.week);

    if (!data.length) {
        container.append("div").attr("class", "parallel-empty").text("No W/TUG data available.");
        filteredData = cachedDashboardRows.slice();
        updateParallelFilterControls(0, filteredData.length, cachedDashboardRows.length);
        await Promise.all([
            renderLinePlotWithStd(filteredData),
            renderScatterPlotMatrix(filteredData)
        ]);
        return;
    }

    const svg = container
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    const chart = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const x = d3.scalePoint().domain(dimensions).range([0, plotWidth]).padding(0.2);

    const yByDimension = {};
    dimensions.forEach((dimension) => {
        const extent = d3.extent(data, (row) => row[dimension]);
        yByDimension[dimension] = d3
            .scaleLinear()
            .domain(extent[0] === extent[1] ? [extent[0] - 1, extent[1] + 1] : extent)
            .nice()
            .range([plotHeight, 0]);
    });

    const line = d3
        .line()
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
            .attr("stroke-width", (row) => (rowPassesParallelFilters(row, dimensions) ? 1.3 : 1.1))
            .attr("opacity", (row) => (rowPassesParallelFilters(row, dimensions) ? 0.62 : 0.15));
    };

    const axis = chart
        .selectAll(".pc-axis")
        .data(dimensions)
        .enter()
        .append("g")
        .attr("class", "pc-axis")
        .attr("transform", (dimension) => `translate(${x(dimension)},0)`)
        .each(function(dimension) {
            d3.select(this).call(d3.axisLeft(yByDimension[dimension]).ticks(4));
        });

    axis
        .append("text")
        .attr("y", -8)
        .attr("text-anchor", "middle")
        .attr("fill", "#111")
        .style("font-size", "12px")
        .text((dimension) => dimension);

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

    const color = d3.scaleOrdinal(d3.schemeCategory10);
    dimensions.forEach((dimension) => {
        const line = d3
            .line()
            .x((d) => x(d.week))
            .y((d) => y(d[dimension]));

        const areaToShade = d3
            .area()
            .x((d) => x(d.week))
            .y0((d) => y(d[dimension] - d[`${dimension}-STD`]))
            .y1((d) => y(d[dimension] + d[`${dimension}-STD`]));

        chart
            .append("path")
            .datum(data)
            .attr("fill", "none")
            .attr("stroke", color(dimension))
            .attr("stroke-width", 1)
            .attr("d", line);

        chart
            .append("path")
            .datum(data)
            .attr("fill", color(dimension))
            .attr("opacity", 0.5)
            .attr("d", areaToShade);
    });
}

async function renderScatterPlotMatrix(rows = []) {
    if (!window.d3) {
        console.error("D3 did not load. The scatter plot cannot render.");
        return;
    }

    const container = d3.select("#scatter-plot-matrix");
    container.selectAll("*").remove();

    container
        .append("div")
        .style("font-size", "14px")
        .style("color", "#475569")
        .text(`scatter-plot-matrix (${rows.length} rows)`);
}

function metricLabel(metricKey) {
    if (METRIC_METADATA[metricKey] && METRIC_METADATA[metricKey].name) {
        return METRIC_METADATA[metricKey].name;
    }
    return metricKey;
}

function metricUnit(metricKey) {
    if (METRIC_METADATA[metricKey] && METRIC_METADATA[metricKey].unit) {
        return METRIC_METADATA[metricKey].unit;
    }
    return "";
}

async function renderViolinPlot(rows) {
    if (!window.d3) {
        console.error("D3 did not load. The violin plot cannot render.");
        return;
    }

    const container = d3.select("#violin-plot");
    container.selectAll("*").remove();

    const el = document.getElementById("violin-plot");
    if (!el) return;

    const allKeys = rows.length ? Object.keys(rows[0]) : [];
    const metricKeys = allKeys.filter((key) => rows.some((row) => Number.isFinite(Number(row[key]))));

    if (!metricKeys.length) {
        container.text("No numeric metrics available.");
        return;
    }

    if (!metricKeys.includes(selectedViolinMetricKey)) {
        selectedViolinMetricKey = metricKeys[0];
    }

    const controls = container.append("div").attr("class", "violin-controls");
    controls
        .append("select")
        .attr("id", "violin-metric-select")
        .on("change", function() {
            selectedViolinMetricKey = this.value;
            renderViolinPlot(cachedDashboardRows);
        })
        .selectAll("option")
        .data(metricKeys)
        .enter()
        .append("option")
        .attr("value", (key) => key)
        .property("selected", (key) => key === selectedViolinMetricKey)
        .text((key) => metricLabel(key));

    const chartWrap = container.append("div").attr("class", "violin-chart-wrap");
    const frame = getPlotFrame("violin-plot", PLOT_LAYOUT.violinControlsHeightRatio);
    if (!frame) return;
    const { width, height, margin, plotWidth, plotHeight } = frame;

    const activityLabels = {
        W: "Walking",
        WALKING: "Walking",
        TUG: "TUG",
        STS: "STS",
        SC: "SC"
    };
    const activityOrder = ["W", "TUG", "STS", "SC", "WALKING"];
    const metricKey = selectedViolinMetricKey;

    const valuesByActivity = new Map();
    rows.forEach((row) => {
        const rawActivity = String(row.activity || "").trim().toUpperCase();
        const value = Number(row[metricKey]);
        if (!Number.isFinite(value)) return;
        if (!valuesByActivity.has(rawActivity)) valuesByActivity.set(rawActivity, []);
        valuesByActivity.get(rawActivity).push(value);
    });

    const groups = Array.from(valuesByActivity.entries())
        .map(([activityCode, values]) => ({
            code: activityCode,
            key: activityLabels[activityCode] || activityCode,
            values
        }))
        .filter((group) => group.values.length > 0)
        .sort((a, b) => {
            const ai = activityOrder.indexOf(a.code);
            const bi = activityOrder.indexOf(b.code);
            const aRank = ai === -1 ? 999 : ai;
            const bRank = bi === -1 ? 999 : bi;
            return aRank - bRank;
        });

    if (!groups.length) {
        chartWrap.append("div").attr("class", "violin-empty").text(`No data available for ${metricLabel(metricKey)}.`);
        return;
    }

    const allValues = groups.flatMap((group) => group.values);
    const yExtent = d3.extent(allValues);
    if (!Number.isFinite(yExtent[0]) || !Number.isFinite(yExtent[1])) {
        chartWrap.append("div").attr("class", "violin-empty").text(`No data available for ${metricLabel(metricKey)}.`);
        return;
    }

    const svg = chartWrap
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    const chart = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const x = d3.scaleBand().domain(groups.map((group) => group.key)).range([0, plotWidth]).padding(0.35);
    const y = d3.scaleLinear().domain([yExtent[0], yExtent[1]]).nice().range([plotHeight, 0]);

    chart.append("g").call(d3.axisLeft(y).ticks(5));
    chart.append("g").attr("transform", `translate(0,${plotHeight})`).call(d3.axisBottom(x));
    chart
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -plotHeight / 2)
        .attr("y", -38)
        .attr("text-anchor", "middle")
        .style("font-size", "12px")
        .text(`${metricLabel(metricKey)} ${metricUnit(metricKey)}`.trim());

    const kde = kernelDensityEstimator(kernelEpanechnikov(7), y.ticks(60));
    const densityByGroup = groups.map((group) => ({
        key: group.key,
        density: kde(group.values)
    }));
    const maxDensity = d3.max(densityByGroup, (group) => d3.max(group.density, (d) => d[1])) || 1;
    const xDensity = d3.scaleLinear().domain([-maxDensity, maxDensity]).range([0, x.bandwidth()]);

    chart
        .selectAll(".violin")
        .data(densityByGroup)
        .enter()
        .append("g")
        .attr("transform", (group) => `translate(${x(group.key)},0)`)
        .append("path")
        .datum((group) => group.density)
        .attr("fill", "#83b2ff")
        .attr("stroke", "#00195f")
        .attr(
            "d",
            d3
                .area()
                .x0((d) => xDensity(-d[1]))
                .x1((d) => xDensity(d[1]))
                .y((d) => y(d[0]))
                .curve(d3.curveCatmullRom)
        );
}

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

async function renderDashboard() {
    const rows = await d3.csv(RESEARCHER_DATA_PATH);
    cachedDashboardRows = rows;
    filteredData = rows.slice();

    await renderParallelCoordinatesPlot(cachedDashboardRows);
    await renderViolinPlot(cachedDashboardRows);
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
