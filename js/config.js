/**
 * VisGait - Shared Configuration
 * Central definitions for metrics, colors, and tooltip descriptions
 * used across researcher-view.js and patient-view.js.
 */

// ─── Group Color Encoding ───────────────────────────────────────────────
const GROUP_COLORS = {
    improving: "#2ecc71",
    declining: "#e74c3c",
    stable:    "#3498db"
};

// ─── Activity → Available Metric Columns ────────────────────────────────
// Only metrics that have REAL (non-NaN) values for each activity.
const ACTIVITY_METRICS = {
    W: [
        "IPI_left_mean_sec",
        "IPI_left_std_sec",
        "cadence_left_steps_min",
        "gait_index_left_pct",
        "IPI_right_mean_sec",
        "IPI_right_std_sec",
        "cadence_right_steps_min",
        "gait_index_right_pct",
        "GSI_pct",
        "symmetry_ratio",
        "GA_signed_pct",
        "cadence_total_steps_min",
        "left_peaks",
        "right_peaks",
        "total_peaks",
        "total_duration_sec",
        "composite_score"
    ],
    TUG: [
        "IPI_left_mean_sec",
        "IPI_left_std_sec",
        "cadence_left_steps_min",
        "gait_index_left_pct",
        "IPI_right_mean_sec",
        "IPI_right_std_sec",
        "cadence_right_steps_min",
        "gait_index_right_pct",
        "GSI_pct",
        "symmetry_ratio",
        "GA_signed_pct",
        "cadence_total_steps_min",
        "left_peaks",
        "right_peaks",
        "total_peaks",
        "total_duration_sec",
        "composite_score"
    ],
    SC: [
        "step_time_mean_sec",
        "step_time_std_sec",
        "step_time_cv_pct",
        "cycle_time_mean_sec",
        "cycle_time_std_sec",
        "cycle_time_cv_pct",
        "total_peaks",
        "total_steps",
        "num_cycles",
        "total_duration_sec",
        "composite_score"
    ],
    STS: [
        "step_time_mean_sec",
        "step_time_std_sec",
        "step_time_cv_pct",
        "cycle_time_mean_sec",
        "cycle_time_std_sec",
        "cycle_time_cv_pct",
        "total_peaks",
        "total_steps",
        "num_cycles",
        "total_duration_sec",
        "composite_score"
    ]
};

// ─── Metric Info Tooltips ───────────────────────────────────────────────
// Human-readable descriptions shown on hover over any metric label.
const METRIC_INFO = {
    // ── W / TUG gait metrics ──
    IPI_left_mean_sec:
        "Left Inter-Peak Interval (Mean) - average time in seconds between consecutive left foot strikes. Lower values indicate faster stepping.",
    IPI_left_std_sec:
        "Left Inter-Peak Interval (Std Dev) - variability of left foot strike timing in seconds. Higher values suggest less consistent gait.",
    IPI_right_mean_sec:
        "Right Inter-Peak Interval (Mean) - average time in seconds between consecutive right foot strikes.",
    IPI_right_std_sec:
        "Right Inter-Peak Interval (Std Dev) - variability of right foot strike timing in seconds.",
    cadence_left_steps_min:
        "Left Cadence - number of left foot steps per minute. Higher cadence generally indicates a faster walking pace.",
    cadence_right_steps_min:
        "Right Cadence - number of right foot steps per minute.",
    cadence_total_steps_min:
        "Total Cadence - combined steps per minute from both feet. A common clinical measure of walking speed.",
    gait_index_left_pct:
        "Left Gait Index (%) - regularity score for the left leg's gait pattern. Higher values indicate a more consistent, periodic stride.",
    gait_index_right_pct:
        "Right Gait Index (%) - regularity score for the right leg's gait pattern.",
    GSI_pct:
        "Gait Symmetry Index (%) - measures overall symmetry between left and right gait. Lower values indicate more symmetric (healthier) gait.",
    symmetry_ratio:
        "Symmetry Ratio - ratio of left to right step timing. A value of 1.0 indicates perfect bilateral symmetry.",
    GA_signed_pct:
        "Gait Asymmetry (Signed %) - directional asymmetry measure. Positive = right-leg dominant, negative = left-leg dominant. Zero = symmetric.",
    left_peaks:
        "Left Peaks - total number of detected left foot strikes during the activity.",
    right_peaks:
        "Right Peaks - total number of detected right foot strikes during the activity.",

    // ── SC / STS step & cycle metrics ──
    step_time_mean_sec:
        "Step Time (Mean) - average duration of a single step in seconds.",
    step_time_std_sec:
        "Step Time (Std Dev) - variability of step duration in seconds. Higher values indicate less rhythmic stepping.",
    step_time_cv_pct:
        "Step Time Variability (CV %) - coefficient of variation of step timing. A normalized measure of stepping consistency; lower is better.",
    cycle_time_mean_sec:
        "Gait Cycle Time (Mean) - average duration of one full gait cycle (heel-strike to heel-strike) in seconds.",
    cycle_time_std_sec:
        "Gait Cycle Time (Std Dev) - variability of gait cycle duration in seconds.",
    cycle_time_cv_pct:
        "Gait Cycle Variability (CV %) - coefficient of variation of gait cycle timing. Lower values indicate more rhythmic, stable gait.",
    total_steps:
        "Total Steps - number of individual steps detected during the activity.",
    num_cycles:
        "Number of Cycles - total sit-to-stand or stair-climbing cycles completed during the activity.",

    // ── Universal metrics ──
    total_peaks:
        "Total Peaks - total number of detected foot strikes (both feet combined) during the activity.",
    total_duration_sec:
        "Total Duration (sec) - total time in seconds to complete the activity from start to finish.",
    composite_score:
        "Composite Score (0-100) - weighted combination of multiple gait metrics into a single performance score. Higher is better. Formula: (GSI × w₁ + Symmetry × w₂ + …) / Σweights.",

    // ── Normalized versions (0-1 scale) ──
    GSI_pct_norm:
        "Gait Symmetry Index (Normalized 0-1) - min-max normalized version of GSI_pct for cross-metric comparison.",
    symmetry_ratio_norm:
        "Symmetry Ratio (Normalized 0-1) - min-max normalized version of symmetry_ratio.",
    cadence_total_steps_min_norm:
        "Total Cadence (Normalized 0-1) - min-max normalized version of cadence_total_steps_min.",
    gait_index_left_pct_norm:
        "Left Gait Index (Normalized 0-1) - min-max normalized version of gait_index_left_pct.",
    gait_index_right_pct_norm:
        "Right Gait Index (Normalized 0-1) - min-max normalized version of gait_index_right_pct.",
    step_time_cv_pct_norm:
        "Step Time CV (Normalized 0-1) - min-max normalized version of step_time_cv_pct.",
    cycle_time_cv_pct_norm:
        "Gait Cycle CV (Normalized 0-1) - min-max normalized version of cycle_time_cv_pct.",
    composite_score_norm:
        "Composite Score (Normalized 0-1) - min-max normalized version of composite_score.",
    total_duration_sec_norm:
        "Total Duration (Normalized 0-1) - min-max normalized version of total_duration_sec.",
    total_peaks_norm:
        "Total Peaks (Normalized 0-1) - min-max normalized version of total_peaks.",

    // ── Cross-activity / ranking ──
    composite_score_overall:
        "Overall Composite Score - composite performance score averaged across all four activities.",
    perf_change_pct_SC:
        "Performance Change SC (%) - percentage change in Stair Climbing performance from baseline (week 1).",
    perf_change_pct_STS:
        "Performance Change STS (%) - percentage change in Sit-to-Stand performance from baseline.",
    perf_change_pct_TUG:
        "Performance Change TUG (%) - percentage change in Timed Up & Go performance from baseline.",
    perf_change_pct_W:
        "Performance Change W (%) - percentage change in Walking performance from baseline.",
    perf_change_pct_overall:
        "Overall Performance Change (%) - percentage change in overall composite score from baseline.",
    percentile_rank_absolute:
        "Percentile Rank (Absolute) - the patient's rank among all patients based on absolute performance (0-100).",
    percentile_rank_improvement:
        "Percentile Rank (Improvement) - the patient's rank based on rate of improvement over time (0-100)."
};

// ─── Helper: get metric tooltip text ────────────────────────────────────
function getMetricTooltip(metricKey) {
    return METRIC_INFO[metricKey] || metricKey;
}
