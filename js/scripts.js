// scripts.js

// 1. global variables
const patientButton = document.getElementById("tab-button-patient");
const researcherButton = document.getElementById("tab-button-researcher");

const patientContent = document.querySelector(".patient-content");
const researcherContent = document.querySelector(".researcher-content");
const ACTIVE_MODE_KEY = "visgateActiveMode";
let selectedViolinMetricKey = "cadence_total_steps_min";
const METRIC_METADATA = {
  cadence_total_steps_min: {
    name: "Cadence",
    description: "Total cadence across detected steps",
    unit: "[steps/min]"
  },
  GSI_pct: {
    name: "GSI",
    description: "Gait Symmetry Index in percentage",
    unit: "[%]"
  },
  gait_index_left_pct: {
    name: "GIL",
    description: "Gait Index Left in percentage",
    unit: "[%]"
  },
  gait_index_right_pct: {
    name: "GIR",
    description: "Gait Index Right in percentage",
    unit: "[%]"
  },
  symmetry_ratio: {
    name: "Symmetry Ratio",
    description: "Left/right symmetry ratio",
    unit: "[-]"
  },
  step_time_mean_sec: {
    name: "Step Time Mean",
    description: "Mean step time",
    unit: "[s]"
  },
  cycle_time_mean_sec: {
    name: "Cycle Time Mean",
    description: "Mean cycle time",
    unit: "[s]"
  }
};

// 1.2 Line chart variables
const widthLineChart = 450;
const heightLineChart = 360;
const marginLineChart = { top: 20, right: 30, bottom: 40, left: 45 };

// 2. Functions
function showPatientOnly() {
  patientButton.classList.add("active");
  researcherButton.classList.remove("active");
  patientContent.style.display = "flex";
  researcherContent.style.display = "none";
  localStorage.setItem(ACTIVE_MODE_KEY, "patient");
}

function showResearcherOnly() {
  researcherButton.classList.add("active");
  patientButton.classList.remove("active");
  researcherContent.style.display = "flex";
  patientContent.style.display = "none";
  localStorage.setItem(ACTIVE_MODE_KEY, "researcher");
  renderParallelCoordinatesPlot();
  renderViolinPlot();
  renderLineChartWithSTD();
}

function getStandardDeviation (array) {
    const n = array.length
    const mean = array.reduce((a, b) => a + b) / n
    return Math.sqrt(array.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n)
}

async function renderViolinPlot() {
    if (!window.d3) {
        console.error("D3 did not load. The violin plot cannot render.");
        return;
    }

    const container = d3.select("#violin-plot");
    container.selectAll("*").remove();

    const el = document.getElementById("violin-plot");
    const metricKeys = Object.keys(METRIC_METADATA);
    if (!metricKeys.includes(selectedViolinMetricKey)) {
        selectedViolinMetricKey = metricKeys[0];
    }

    const controls = container.append("div").attr("class", "violin-controls");
    controls
        .append("select")
        .attr("id", "violin-metric-select")
        .on("change", function() {
            selectedViolinMetricKey = this.value;
            renderViolinPlot();
        })
        .selectAll("option")
        .data(metricKeys)
        .enter()
        .append("option")
        .attr("value", (key) => key)
        .property("selected", (key) => key === selectedViolinMetricKey)
        .text((key) => `${METRIC_METADATA[key].name}`);

    const chartWrap = container.append("div").attr("class", "violin-chart-wrap");
    const width = Math.max(1, chartWrap.node().clientWidth || el.clientWidth);
    const height = Math.max(120, chartWrap.node().clientHeight || (el.clientHeight - 40));
    const margin = { top: 12, right: 20, bottom: 30, left: 54 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const rows = await d3.csv("data/dashboard_data.csv");
    const activityLabels = {
        W: "Walking",
        WALKING: "Walking",
        TUG: "TUG",
        STS: "STS",
        SC: "SC"
    };
    const activityOrder = ["W", "TUG", "STS", "SC", "WALKING"];
    const metricKey = selectedViolinMetricKey;
    const metricMeta = METRIC_METADATA[metricKey] || {
        name: metricKey,
        description: "",
        unit: "[unit]"
    };

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
        chartWrap.append("div").attr("class", "violin-empty").text(`No data available for ${metricMeta.name}.`);
        return;
    }

    const allValues = groups.flatMap((group) => group.values);
    const yExtent = d3.extent(allValues);
    if (!Number.isFinite(yExtent[0]) || !Number.isFinite(yExtent[1])) {
        chartWrap.append("div").attr("class", "violin-empty").text(`No data available for ${metricMeta.name}.`);
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
        .text(`${metricMeta.name} ${metricMeta.unit}`);

    chart.selectAll(".tick text").style("font-size", "12px");
    chart.selectAll(".tick line, .domain").style("stroke-width", 1);

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

async function renderParallelCoordinatesPlot() {
    if (!window.d3) {
        console.error("D3 did not load. The parallel coordinates plot cannot render.");
        return;
    }

    const container = d3.select("#parallel-coord-plot");
    container.selectAll("*").remove();

    const el = document.getElementById("parallel-coord-plot");
    const width = el.clientWidth;
    const height = el.clientHeight;
    const margin = { top: 20, right: 20, bottom: 28, left: 20 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const rows = await d3.csv("data/dashboard_data.csv");
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
            "Cadence": d3.mean([row["Cadence-TUG"], row["Cadence-W"]].filter(Number.isFinite)),
            "Symmetry Ratio": d3.mean([row["Symmetry-TUG"], row["Symmetry-W"]].filter(Number.isFinite))
        }))
        .filter((row) => dimensions.every((dimension) => Number.isFinite(row[dimension])))
        .sort((a, b) => a.week - b.week);

    if (!data.length) {
        container.text("No W/TUG data available.");
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

    chart
        .selectAll(".pc-line")
        .data(data)
        .enter()
        .append("path")
        .attr("class", "pc-line")
        .attr("fill", "none")
        .attr("stroke", "#3b82f6")
        .attr("stroke-width", 1.2)
        .attr("opacity", 0.45)
        .attr("d", (row) => line(dimensions.map((dimension) => [dimension, row[dimension]])));

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
}

async function renderLineChartWithSTD() {
    if (!window.d3) {
        console.error("D3 did not load. The LineChart cannot render.");
        return;
    }
    const container = d3.select("#line-plot-with-std");
    container.selectAll("*").remove();

    const el = document.getElementById("line-plot-with-std");
    const width = el.clientWidth;
    const height = el.clientHeight;
    const margin = { top: 20, right: 20, bottom: 28, left: 20 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    
    const rows = await d3.csv("data/dashboard_data.csv");
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
    
    var maxWeek = 0;
    var minWeek = 1
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
    
    const dimensions = [
        "GSI-TUG",
        "GSI-W",
        "GIR-TUG",
        "GIL-TUG",
        "GIR-W",
        "GIL-W"
    ];

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
            "GIL-W-STD": row["GIL-W-STD"],
        }))
        .filter((row) => dimensions.every((dimension) => Number.isFinite(row[dimension])))
        .sort((a, b) => a.week - b.week);


    
    const svg = container
        .append("svg")
        .attr("width", widthLineChart + marginLineChart.left + marginLineChart.right)
        .attr("height", heightLineChart + marginLineChart.top + marginLineChart.bottom);

    const chart = svg
        .append("g")
        .attr("transform", `translate(${marginLineChart.left},${marginLineChart.top})`);

    const y = d3
        .scaleLinear()
        .range([heightLineChart, 0]);
    const x = d3
        .scaleLinear()
        .range([0, widthLineChart])

    x.domain([minWeek, maxWeek])
    y.domain([-5, 50])

    chart.append("g").call(d3.axisLeft(y));
    chart
        .append("g")
        .attr("transform", `translate(0,${heightLineChart})`)
        .call(d3.axisBottom(x));
        
    const color = d3.scaleOrdinal(d3.schemeCategory10);

    dimensions.forEach((dim) =>{
        const line = d3.line()
            .x(d=>x(d.week))
            .y(d=>y(d[dim]))
        
        const areaToShade = d3.area()
            .x(d=>x(d.week))
            .y0(d=>y(d[dim] - d[dim+"-STD"]))
            .y1(d=>y(d[dim] + d[dim+"-STD"]))

        
        chart.append("path")
            .datum(data)
            .attr("fill", "none")
            .attr("stroke", color(dim))
            .attr("stroke-width", 1)
            .attr("d", line)
        
        chart.append("path")
            .datum(data)
            .attr("fill", color(dim))
            .attr("opacity", 0.5)
            .attr("d", areaToShade)
        console.log(color[dim])
    })
    }

function renderTestLineChart() {
    if (!window.d3) {
        console.error("D3 did not load. The violin plot cannot render.");
        return;
    }

    const container = d3.select("#patient-visualization");
    container.selectAll("*").remove();

    const svg = container
        .append("svg")
        .attr("width", widthLineChart + marginLineChart.left + marginLineChart.right)
        .attr("height", heightLineChart + marginLineChart.top + marginLineChart.bottom);

    const chart = svg
        .append("g")
        .attr("transform", `translate(${marginLineChart.left},${marginLineChart.top})`);

    const y = d3
        .scaleLinear()
        .range([heightLineChart, 0]);
    const x = d3
        .scaleLinear()
        .range([0, widthLineChart])

    const dataset = [
        {session:1, value:-4},
        {session:2, value:-4},
        {session:3, value:-3},
        {session:4, value:-3},
        {session:5, value:-2},
        {session:6, value:-2},
        {session:7, value:-1},
        {session:8, value:-1},
        {session:9, value:-1},
        {session:10, value:-0}
    ]; // todo: Replace const dataset with real data

    x.domain(d3.extent(dataset, d => d.session))
    y.domain([d3.min(dataset, d => d.value), 0])

    chart.append("g").call(d3.axisLeft(y));
    chart
        .append("g")
        .attr("transform", `translate(0,${heightLineChart})`)
        .call(d3.axisBottom(x));

    const line = d3.line()
        .x(d=>x(d.session))
        .y(d=>y(d.value))
    
    chart.append("path")
        .datum(dataset)
        .attr("fill", "none")
        .attr("stroke", "steelblue")
        .attr("stroke-width", 1)
        .attr("d", line)

    chart.selectAll("myCircles")
        .data(dataset)
        .enter()
        .append("circle") // enter append
            .attr("class", "session-value")
            .attr("r", "3") // radius
            .attr("cx", function(d) { return x(d.session) })   // center x passing through your xScale
            .attr("cy", function(d) { return y(d.value)})   // center y through your yScale
    // todo: Add highlighting of points and add data windows
}


// 2 functions needed for kernel density estimate
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

// 3. Event listeners
patientButton.addEventListener("click", showPatientOnly);
researcherButton.addEventListener("click", showResearcherOnly);
renderTestLineChart();

// Restore last selected mode. Default to patient for first-time visitors.
const savedMode = localStorage.getItem(ACTIVE_MODE_KEY);
if (savedMode === "researcher") {
    showResearcherOnly();
} else {
    showPatientOnly();
}
// About modal
const btnAbout = document.getElementById("btn-about");
const modalAbout = document.getElementById("modal-about");
btnAbout.addEventListener("click", () => modalAbout.classList.add("open"));
modalAbout.addEventListener("click", (e) => {
    if (e.target === modalAbout) modalAbout.classList.remove("open");
});