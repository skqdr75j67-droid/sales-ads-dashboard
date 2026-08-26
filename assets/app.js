"use strict";

const DATA_URL = window.DASHBOARD_DATA_URL || "data/sales_ads_dashboard_data.json";
const WEEKLY_DATA_URL = window.WEEKLY_REPORT_DATA_URL || "亚马逊周报月报/output/latest.json";

const PAGE_CONFIG = {
  monthly_review: {
    title: "月度广告数据复盘看板",
    sections: [
      ["monthly-overview", "整体大盘"],
      ["monthly-category", "品类视角"],
      ["monthly-owner", "运营组长视角"],
      ["monthly-sbsd-share", "SBSD广告活动占比分析"],
    ],
  },
  weekly_review: {
    title: "亚马逊周报月报",
    sections: [
      ["report-attention", "需关注"],
      ["report-required", "指定"],
      ["report-batch-monitor", "批量广告异常监测"],
      ["report-self-invest", "自投"],
    ],
  },
  invalid_low_efficiency: {
    title: "无效低效广告看板",
    sections: [
      ["invalid-analysis", "无效广告分析"],
      ["inefficient-analysis", "低效广告分析"],
      ["saving-analysis", "节约花费视角"],
      ["invalid-detail", "广告活动明细"],
    ],
  },
  lingxing_rules: {
    title: "领星规则看板",
    sections: [
      ["trigger-monitor", "规则触发监控"],
      ["special-monitor", "专项规则视图"],
      ["saving-detail", "节费规则触发明细"],
    ],
  },
  batch_launch: {
    title: "批量投放看板",
    sections: [
      ["batch-scale", "批量投放规模"],
      ["batch-coverage", "活动覆盖率"],
      ["batch-low-efficiency", "低效批量广告"],
      ["batch-summary", "批量投放汇总明细"],
      ["batch-operation-detail", "批量投放批次查询"],
      ["batch-demand-stats", "上周需求统计"],
    ],
  },
};

const state = {
  data: null,
  weeklyReport: null,
  weeklyLoadError: "",
  page: "monthly_review",
  filterDraft: {},
  filterApplied: {},
  // 默认“全部”是隐式状态；仅在用户实际勾选或点全选/清除后变为手动筛选。
  filterManual: {},
  searchDraft: {},
  searchApplied: {},
  detailFilters: {},
  sharedFilters: {
    owner: { all: true, values: new Set() },
    category: { all: true, values: new Set() },
  },
  sharedFilterDirty: new Set(),
  invalidDetailSearch: {
    draft: "",
    applied: "",
  },
  invalidDetailDays: {
    minDraft: "",
    maxDraft: "",
    minApplied: null,
    maxApplied: null,
  },
  batchOperationDays: {
    minDraft: "",
    maxDraft: "",
    minApplied: null,
    maxApplied: null,
  },
  pagination: {},
  ui: {
    monthlyCategoryTab: "all",
    weeklySelfTab: "overall",
    reportType: "monthly",
    reportMonth: "",
    reportWeek: "",
    reportSelectionId: "",
    reportOwnersDraft: new Set(),
    reportOwnersApplied: new Set(),
    reportCategoriesDraft: new Set(),
    reportCategoriesApplied: new Set(),
    reportFilterManual: { owner: false, category: false },
    invalidDetailTab: "all",
    batchSummaryTab: "category",
  },
};

// 仅记录匿名的看板使用行为，不发送运营姓名、品类或其他业务明细。
function trackUsage(eventName, parameters = {}) {
  if (typeof window.gtag !== "function") return;
  window.gtag("event", eventName, {
    dashboard_page: state.page || "unknown",
    ...parameters,
  });
}

const root = document.getElementById("page-root");
const loading = document.getElementById("loading-state");
const errorState = document.getElementById("error-state");
const dataStatus = document.getElementById("data-status");
const subnav = document.getElementById("subnav");
const pageTitle = document.getElementById("page-title");

const numberFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const yuanFormatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + asNumber(row[field]), 0);
}

function splitMultiValue(value) {
  return String(value ?? "")
    .split(/[、,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstBatchDateFromBatchNumber(value) {
  const match = String(value ?? "").match(/(\d{6})/);
  if (!match) return null;
  const token = match[1];
  const year = 2000 + Number(token.slice(0, 2));
  const month = Number(token.slice(2, 4));
  const day = Number(token.slice(4, 6));
  if (!month || month > 12 || !day || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function batchOnlineDays(batchNumber) {
  const start = firstBatchDateFromBatchNumber(batchNumber);
  if (!start) return null;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const diffDays = Math.floor((todayStart - startDay) / 86400000) + 1;
  return diffDays > 0 ? diffDays : 1;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((asNumber(value) + Number.EPSILON) * factor) / factor;
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return escapeHtml(value);
  if (digits === 0) return integerFormatter.format(number);
  return number.toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatCompact(value) {
  const number = asNumber(value);
  const absolute = Math.abs(number);
  if (absolute >= 100000000) return `${round(number / 100000000, 1)}亿`;
  if (absolute >= 10000) return `${round(number / 10000, 1)}万`;
  return formatNumber(number, absolute >= 100 ? 0 : 2);
}

function formatCurrency(value, compact = false) {
  const number = asNumber(value);
  if (compact && Math.abs(number) >= 10000) return `$${formatCompact(number)}`;
  return currencyFormatter.format(number);
}

function formatYuan(value) {
  return yuanFormatter.format(asNumber(value));
}

function formatPercent(value, fraction = false, digits = 2) {
  const number = asNumber(value) * (fraction ? 100 : 1);
  return `${formatNumber(number, digits)}%`;
}

function safeDivide(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function changeRate(current, previous) {
  return previous ? (current - previous) / Math.abs(previous) : current ? null : 0;
}

function formatChange(current, previous, format = "number", inverse = false) {
  const delta = asNumber(current) - asNumber(previous);
  const rate = changeRate(current, previous);
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "neutral";
  const favorable = inverse ? delta < 0 : delta > 0;
  const className = direction === "neutral" ? "is-neutral" : favorable ? "is-good" : "is-bad";
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
  let deltaText = formatNumber(Math.abs(delta), 2);
  if (format === "currency") deltaText = formatCurrency(Math.abs(delta));
  if (format === "percent") deltaText = `${formatNumber(Math.abs(delta), 2)} 个百分点`;
  const rateText = rate === null ? "新增" : formatPercent(Math.abs(rate), true, 1);
  return `<span class="delta ${className}">${arrow} ${deltaText} (${rateText})</span>`;
}

function kpiCard({ label, value, previous, valueType = "number", tone = "primary", inverse = false, note = "较上月", description = "", comparisonMarkup = "" }) {
  let display = formatNumber(value, 2);
  if (valueType === "integer") display = formatNumber(value, 0);
  if (valueType === "currency") display = formatCurrency(value, true);
  if (valueType === "yuan") display = formatYuan(value);
  if (valueType === "percent") display = formatPercent(value, false, 2);
  if (valueType === "fractionPercent") display = formatPercent(value, true, 2);
  const compare = comparisonMarkup || (previous === undefined || previous === null
    ? escapeHtml(note)
    : `${note ? `${escapeHtml(note)} ` : ""}${formatChange(value, previous, valueType === "fractionPercent" ? "number" : valueType, inverse)}`);
  return `
    <article class="kpi-card" data-tone="${escapeHtml(tone)}">
      <p class="kpi-card__label">${escapeHtml(label)}</p>
      ${description ? `<p class="kpi-card__description">${escapeHtml(description)}</p>` : ""}
      <p class="kpi-card__value">${display}</p>
      <p class="kpi-card__compare">${compare}</p>
    </article>`;
}

function fractionDeltaPercentOnly(current, previous, inverse = false) {
  const delta = asNumber(current) - asNumber(previous);
  const favorable = inverse ? delta < 0 : delta > 0;
  const className = delta === 0 ? "is-neutral" : favorable ? "is-good" : "is-bad";
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
  return `<span class="delta ${className}">${arrow} ${formatNumber(Math.abs(delta), 2)}%</span>`;
}

function detailMetricCard(label, value, valueType = "number", note = "当前筛选明细") {
  let display = formatNumber(value, 2);
  if (valueType === "integer") display = formatNumber(value, 0);
  if (valueType === "currency") display = formatCurrency(value);
  return `
    <article class="detail-metric">
      <p>${escapeHtml(label)}</p>
      <strong>${display}</strong>
      <span>${escapeHtml(note)}</span>
    </article>`;
}

function introMarkup(title, description, period = "2026年5月 vs 6月", note = "") {
  return `
    <div class="page-intro">
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
        ${note ? `<p class="page-intro__note">${escapeHtml(note)}</p>` : ""}
      </div>
      <span class="period-badge">${escapeHtml(period)}</span>
    </div>`;
}

function sectionHead(title, description = "", meta = "", action = null) {
  return `
    <div class="section-head">
      <div>
        <h3>${escapeHtml(title)}</h3>
        ${description ? `<p>${escapeHtml(description)}</p>` : ""}
      </div>
      ${(meta || action) ? `
        <div class="section-head__actions">
          ${action ? `<a class="section-action" href="${escapeHtml(action.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(action.label)}</a>` : ""}
          ${meta ? `<span class="section-meta">${escapeHtml(meta)}</span>` : ""}
        </div>` : ""}
    </div>`;
}

function emptyState(message = "当前筛选条件下暂无数据") {
  return `<div class="empty-state"><div><strong>暂无结果</strong>${escapeHtml(message)}</div></div>`;
}

function weeklyValue(value, type = "number") {
  if (value === null || value === undefined || value === "") return "数据不足";
  if (type === "integer") return formatNumber(value, 0);
  if (type === "currency") return formatCurrency(value);
  if (type === "percent") return formatPercent(value, true);
  return formatNumber(value, 2);
}

function weeklyMetricType(metric) {
  if (metric?.unit === "count") return "integer";
  if (metric?.unit === "USD") return "currency";
  if (metric?.unit === "ratio") return "percent";
  return "number";
}

function weeklyMetricRule(metricId) {
  if (["front_units", "front_sales", "ad_sales", "cvr"].includes(metricId)) return "higher-good";
  if (["acos", "cpc"].includes(metricId)) return "lower-good";
  return "neutral";
}

function weeklyDelta(metric, rule = "neutral") {
  if (!metric || metric.available === false || [metric.current, metric.previous].some((value) => value === null || value === undefined || value === "")) {
    return `<span class="weekly-delta is-neutral">数据不足</span>`;
  }
  const delta = Number(metric.delta);
  if (!Number.isFinite(delta)) return `<span class="weekly-delta is-neutral">数据不足</span>`;
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
  let tone = "is-neutral";
  if (rule === "higher-good" && delta !== 0) tone = delta > 0 ? "is-good" : "is-bad";
  if (rule === "lower-good" && delta !== 0) tone = delta < 0 ? "is-good" : "is-bad";
  const withinTolerance = metric.id === "acos" && delta > 0 && metric.within_attribution_tolerance === true;
  if (withinTolerance) tone = "is-neutral";
  let text = "持平";
  if (delta !== 0 && metric.unit === "ratio") {
    const percentagePoints = Math.abs(delta) * 100;
    const digits = percentagePoints > 0 && percentagePoints < 0.01 ? 3 : 2;
    text = `${formatNumber(percentagePoints, digits)} 个百分点`;
  } else if (delta !== 0 && metric.delta_rate !== null && metric.delta_rate !== undefined) {
    text = formatPercent(Math.abs(metric.delta_rate), true, 1);
  } else if (delta !== 0) {
    text = weeklyValue(Math.abs(delta), weeklyMetricType(metric));
  }
  const toleranceText = withinTolerance ? `<em>归因容忍内</em>` : "";
  return `<span class="weekly-delta ${tone}">${arrow} ${text}${toleranceText}</span>`;
}

function weeklyKpiCard(metric, tone, rule = "neutral") {
  const type = weeklyMetricType(metric);
  const currentDisplay = type === "currency" && metric?.current !== null && metric?.current !== undefined
    ? formatCurrency(metric.current, true)
    : weeklyValue(metric?.current, type);
  const previousDisplay = type === "currency" && metric?.previous !== null && metric?.previous !== undefined
    ? formatCurrency(metric.previous, true)
    : weeklyValue(metric?.previous, type);
  return `<article class="kpi-card weekly-kpi" data-tone="${escapeHtml(tone)}">
    <p class="kpi-card__label">${escapeHtml(metric?.label || "-")}</p>
    <p class="kpi-card__value">${currentDisplay}</p>
    <div class="weekly-kpi__compare">
      <span>上期 ${previousDisplay}</span>
      ${weeklyDelta(metric, rule)}
    </div>
  </article>`;
}

function weeklyMetricCell(metric, rule = "neutral") {
  const type = weeklyMetricType(metric);
  return `<div class="weekly-metric">
    <span>${escapeHtml(metric?.label || "-")}</span>
    <strong>${weeklyValue(metric?.current, type)}</strong>
    <small><span>上期 ${weeklyValue(metric?.previous, type)}</span>${weeklyDelta(metric, rule)}</small>
  </div>`;
}

function weeklyFactList(findings, emptyMessage = "当前没有达到提示阈值的已确认变化") {
  if (!Array.isArray(findings) || findings.length === 0) {
    return `<p class="weekly-facts-empty">${escapeHtml(emptyMessage)}</p>`;
  }
  return `<ul class="weekly-fact-list">${findings.map((finding) => `<li>${escapeHtml(finding)}</li>`).join("")}</ul>`;
}

function weeklyCategoryCard(category, options = {}) {
  const metrics = category.metrics || {};
  const metricIds = [
    "front_units",
    "front_sales",
    "ad_spend",
    "ad_sales",
    "coupon_promotion_cost",
    "coupon_promotion_rate",
    "acos",
    "cvr",
  ];
  const isHighRisk = options.isHighRisk === true;
  const riskScore = Number(category.risk?.score);
  const badge = isHighRisk
    ? `高风险 #${options.rank}${Number.isFinite(riskScore) ? ` · ${formatNumber(riskScore, 2)}分` : ""}`
    : "固定关注";
  const typeLabel = category.is_required ? "固定品类" : "非固定品类";
  return `<details class="weekly-category-card" open>
    <summary>
      <span class="weekly-category-card__title">
        <strong>${escapeHtml(category.category)}</strong>
        <span>${escapeHtml(typeLabel)}</span>
      </span>
      <span class="weekly-status ${isHighRisk ? "is-danger" : "is-neutral"}">${escapeHtml(badge)}</span>
    </summary>
    <div class="weekly-category-card__body">
      <div class="weekly-metric-grid">
        ${metricIds.map((metricId) => weeklyMetricCell(metrics[metricId], weeklyMetricRule(metricId))).join("")}
      </div>
      <div class="weekly-confirmed-block">
        <strong>已确认现象</strong>
        ${weeklyFactList(category.confirmed_findings)}
      </div>
    </div>
  </details>`;
}

function weeklyOverviewRows(data) {
  const period = data.period || {};
  const rows = [
    ["current", period.current_label, data.overview?.current || {}],
    ["previous", period.previous_label, data.overview?.previous || {}],
  ];
  return rows.map(([periodKey, periodLabel, values]) => ({
    period_key: periodKey,
    period_label: periodLabel,
    ...values,
  }));
}

function weeklyCategoryRows(categories, highRiskNames) {
  return categories.map((category) => ({
    category: category.category,
    attention_type: highRiskNames.has(category.category) ? "高风险 Top 4" : "固定关注",
    risk_score: category.risk?.score,
    ...category.current,
  }));
}

function weeklySelfRows(section, period) {
  return (section?.rows || []).map((row) => ({
    ...row,
    period_label: row.period_key === "current" ? period.current_label : period.previous_label,
  }));
}

function weeklyGeneratedLabel(value) {
  const generated = value ? new Date(value) : null;
  return generatedTimestampLabel(generated, "生成时间未知");
}

function generatedTimestampLabel(value, fallback = "数据已就绪") {
  const date = value instanceof Date ? value : new Date(value);
  if (!date || Number.isNaN(date.valueOf())) return fallback;
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function reportFormatValue(header, value) {
  if (value === null || value === undefined || value === "") return "-";
  const label = String(header || "");
  const number = Number(value);
  if (!Number.isFinite(number)) return escapeHtml(value);
  if (["日期范围", "时期", "父标签", "子标签", "创建人", "operation_classification"].includes(label)) return escapeHtml(value);
  if (label === "CPC变化") return `$${formatNumber(number, 3)}`;
  if (label.includes("环比") || ["ACOS变化", "广告占比变化", "CVR变化", "coupon和促销占比变化", "CTR", "ACOS", "acos", "广告占比", "coupon和促销占比", "CVR"].includes(label)) {
    return formatPercent(number, true, 2);
  }
  if (["前台销量变化", "广告销量变化", "点击数变化", "出库销量", "前台销量", "展示量", "曝光量", "点击数", "点击", "广告销量", "广告活动数", "广告订单"].includes(label)) {
    return formatNumber(number, 0);
  }
  if (label.includes("销售额") || label.includes("花费") || label.includes("费用") || ["CPC", "CPC_$"].includes(label)) {
    return label.startsWith("CPC") ? `$${formatNumber(number, 2)}` : formatCurrency(number);
  }
  return formatNumber(number, 2);
}

const REPORT_DETAIL_TRAILING_COLUMNS = ["展示量", "点击数", "广告占比", "coupon和促销占比"];

function reportDetailColumnWeight(header) {
  const weights = {
    日期范围: 1.35,
    operation_classification: 1.2,
    coupon和促销费用: 1.15,
    出库销量: 0.75,
    出库销售额: 1.35,
    广告花费: 0.95,
    SP广告花费: 0.95,
    SBSD广告花费: 0.95,
    前台销量: 0.75,
    前台销售额: 1.35,
    广告销售额: 1.2,
    广告销量: 0.75,
    CPC_$: 0.65,
    acos: 0.65,
    CVR: 0.65,
  };
  return weights[header] || 0.9;
}

function reportTrailingColumnWidth(header) {
  return {
    展示量: 150,
    点击数: 120,
    广告占比: 120,
    coupon和促销占比: 170,
  }[header] || 120;
}

function syncReportTableWidths() {
  document.querySelectorAll(".report-table--detail").forEach((table) => {
    const shell = table.closest(".report-table-shell");
    const mainColumns = [...table.querySelectorAll("col[data-report-main-weight]")];
    const trailingColumns = [...table.querySelectorAll("col[data-report-trailing-width]")];
    if (!shell || !mainColumns.length) return;
    const visibleWidth = shell.clientWidth;
    const totalWeight = mainColumns.reduce((sum, column) => sum + Number(column.dataset.reportMainWeight || 1), 0);
    let assignedWidth = 0;
    mainColumns.forEach((column, index) => {
      const width = index === mainColumns.length - 1
        ? visibleWidth - assignedWidth
        : Math.round(visibleWidth * Number(column.dataset.reportMainWeight || 1) / totalWeight);
      column.style.width = `${width}px`;
      assignedWidth += width;
    });
    const trailingWidth = trailingColumns.reduce((sum, column) => {
      const width = Number(column.dataset.reportTrailingWidth || 120);
      column.style.width = `${width}px`;
      return sum + width;
    }, 0);
    table.style.width = `${visibleWidth + trailingWidth}px`;
    table.style.minWidth = `${visibleWidth + trailingWidth}px`;
    table.dataset.reportVisibleColumnWidth = String(visibleWidth / mainColumns.length);
  });

  document.querySelectorAll(".report-table--comparison").forEach((table) => {
    const container = table.closest(".report-category-block, #report-overview") || document;
    const detailTable = container.querySelector(".report-table--detail");
    const referenceWidth = Number(detailTable?.dataset.reportVisibleColumnWidth || 112);
    const cellWidth = Math.max(64, Math.round(referenceWidth));
    const columns = [...table.querySelectorAll("col")];
    columns.forEach((column) => { column.style.width = `${cellWidth}px`; });
    table.style.width = `${cellWidth * columns.length}px`;
    table.style.minWidth = `${cellWidth * columns.length}px`;
  });
}

function reportTable(table, tone = "current") {
  const headers = table?.headers || [];
  const rows = table?.rows || [];
  if (!headers.length || !rows.length) return emptyState("该区域暂无表格数据");
  const isDetail = headers.includes("日期范围");
  const isComparison = !isDetail && headers.some((header) => String(header).includes("变化") || String(header).includes("环比"));
  const indexedHeaders = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => tone === "period" || !/coupon|促销/i.test(String(header || "")));
  const displayHeaders = isDetail
    ? [
      ...indexedHeaders.filter(({ header }) => !REPORT_DETAIL_TRAILING_COLUMNS.includes(header)),
      ...REPORT_DETAIL_TRAILING_COLUMNS.flatMap((target) => indexedHeaders.filter(({ header }) => header === target)),
    ]
    : indexedHeaders;
  const typeClass = isDetail ? "report-table--detail" : isComparison ? "report-table--comparison" : "";
  const shellClass = isDetail ? "report-table-shell--detail" : isComparison ? "report-table-shell--comparison" : "";
  const colgroup = isDetail
    ? `<colgroup>${displayHeaders.map(({ header }) => REPORT_DETAIL_TRAILING_COLUMNS.includes(header)
      ? `<col data-report-trailing-width="${reportTrailingColumnWidth(header)}" />`
      : `<col data-report-main-weight="${reportDetailColumnWeight(header)}" />`).join("")}</colgroup>`
    : isComparison ? `<colgroup>${displayHeaders.map(() => "<col />").join("")}</colgroup>` : "";
  return `<div class="report-table-shell ${shellClass}"><table class="report-table ${typeClass}">
    ${colgroup}
    <thead><tr>${displayHeaders.map(({ header }) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row, index) => `<tr class="${index === 0 && tone === "period" ? "is-current" : index === 1 && tone === "period" ? "is-previous" : ""}">
      ${displayHeaders.map(({ header, index: cellIndex }) => `<td>${reportFormatValue(header, row[cellIndex])}</td>`).join("")}
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function reportConclusionText(value) {
  return String(value || "")
    .replace(/[，,]?coupon和促销费用[^；。。]*[；;]coupon和促销占比[^，,。。]*(?=[，,。。]|$)/gi, "")
    .replace(/，。/g, "。")
    .trim();
}

function reportOptions(reports, key, labelKey) {
  const seen = new Set();
  return reports.filter((report) => {
    const value = report[key];
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  }).map((report) => [report[key], report[labelKey]]);
}

function ensureReportSelection() {
  const reports = Array.isArray(state.weeklyReport?.reports) ? state.weeklyReport.reports : [];
  const availableTypes = new Set(reports.map((report) => report.report_type));
  if (!availableTypes.has(state.ui.reportType)) {
    state.ui.reportType = availableTypes.has("monthly") ? "monthly" : reports[0]?.report_type || "";
  }
  const typeReports = reports.filter((report) => report.report_type === state.ui.reportType);
  const months = reportOptions(typeReports, "month_key", "month_label");
  if (!months.some(([value]) => value === state.ui.reportMonth)) state.ui.reportMonth = months[0]?.[0] || "";
  const monthReports = typeReports.filter((report) => report.month_key === state.ui.reportMonth);
  const weeks = state.ui.reportType === "weekly"
    ? reportOptions(monthReports, "week_label", "week_label")
    : [];
  if (state.ui.reportType === "weekly" && !weeks.some(([value]) => value === state.ui.reportWeek)) {
    state.ui.reportWeek = weeks[0]?.[0] || "";
  }
  const report = state.ui.reportType === "weekly"
    ? monthReports.find((item) => item.week_label === state.ui.reportWeek) || null
    : monthReports[0] || null;
  if (report && state.ui.reportSelectionId !== report.id) {
    state.ui.reportSelectionId = report.id;
    syncReportFiltersFromShared(report);
    state.ui.weeklySelfTab = report.self_sections?.[0]?.key || "overall";
  }
  return { reports, typeReports, months, weeks, report };
}

function reportSelect(label, name, options, selected) {
  return `<label class="report-filter-field"><span>${escapeHtml(label)}</span><select data-report-select="${escapeHtml(name)}">
    ${options.map(([value, text]) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}
  </select></label>`;
}

const SHARED_CATEGORY_ALIASES = {
  滤清器: "滤清",
  三元催化器: "三元催化",
  减震器: "减震",
  点火系统: "点火套件",
  散热器风扇: "散热器",
};

function sharedFilterValue(kind, value) {
  const normalized = String(value || "").trim();
  return kind === "category" ? (SHARED_CATEGORY_ALIASES[normalized] || normalized) : normalized;
}

function sharedSelection(options, kind) {
  const shared = state.sharedFilters[kind];
  if (shared.all) return new Set(options);
  return new Set(options.filter((option) => shared.values.has(sharedFilterValue(kind, option))));
}

function updateSharedFilter(kind, selected, options) {
  const allSelected = options.length > 0 && selected.size === options.length
    && options.every((option) => selected.has(option));
  state.sharedFilters[kind] = {
    all: allSelected,
    values: allSelected ? new Set() : new Set([...selected].map((value) => sharedFilterValue(kind, value))),
  };
  state.sharedFilterDirty.delete(kind);
}

function visibleReportCategories(report) {
  return (report.categories || []).filter((category) => ["attention", "required"].includes(category.group));
}

function syncReportFiltersFromShared(report) {
  const categories = visibleReportCategories(report).map((category) => category.category);
  const owners = reportOwnerData(report).owners;
  state.ui.reportOwnersDraft = sharedSelection(owners, "owner");
  state.ui.reportOwnersApplied = cloneSet(state.ui.reportOwnersDraft);
  state.ui.reportCategoriesDraft = sharedSelection(categories, "category");
  state.ui.reportCategoriesApplied = cloneSet(state.ui.reportCategoriesDraft);
  state.ui.reportFilterManual.owner = !state.sharedFilters.owner.all;
  state.ui.reportFilterManual.category = !state.sharedFilters.category.all;
}

function reportOwnerData(report) {
  const sourceRows = state.data?.monthly_review?.category_overview || [];
  const sourceMap = new Map();
  sourceRows.forEach((row) => {
    const category = String(row.品类 || "").trim();
    const owner = String(row.运营组长 || "").trim();
    if (!category || !owner) return;
    if (!sourceMap.has(category)) sourceMap.set(category, new Set());
    sourceMap.get(category).add(owner);
  });
  const categoryOwners = new Map();
  const owners = [];
  visibleReportCategories(report).forEach(({ category }) => {
    const lookupCategory = SHARED_CATEGORY_ALIASES[category] || category;
    const matchedOwners = [...(sourceMap.get(lookupCategory) || [])];
    const resolvedOwners = matchedOwners.length ? matchedOwners : ["未匹配运营组长"];
    categoryOwners.set(category, new Set(resolvedOwners));
    resolvedOwners.forEach((owner) => {
      if (!owners.includes(owner)) owners.push(owner);
    });
  });
  return { owners, categoryOwners };
}

function reportSelectionMarkup(options, selected, emptyLabel) {
  const selectedNames = options.filter((option) => selected.has(option));
  if (!selectedNames.length) return `<strong data-report-category-summary-primary>${escapeHtml(emptyLabel)}</strong>`;
  const extraCount = selectedNames.length - 1;
  return `<strong data-report-category-summary-primary>${escapeHtml(selectedNames[0])}</strong>
    ${extraCount > 0 ? `<em data-report-category-summary-count>+${extraCount}</em>` : ""}`;
}

function reportMultiFilter(report, kind) {
  const isOwner = kind === "owner";
  const options = isOwner ? reportOwnerData(report).owners : visibleReportCategories(report).map((category) => category.category);
  const applied = isOwner ? state.ui.reportOwnersApplied : state.ui.reportCategoriesApplied;
  const draft = isOwner ? state.ui.reportOwnersDraft : state.ui.reportCategoriesDraft;
  const label = isOwner ? "运营组长" : "品类";
  return `<details class="report-category-filter" data-report-filter-kind="${kind}">
    <summary><span class="report-category-filter__label">${label}</span><span class="report-category-filter__selection">${reportSelectionMarkup(options, applied, `未选择${label}`)}</span></summary>
    <div class="report-category-filter__panel">
      <input type="search" placeholder="搜索${label}" data-report-filter-search />
      <div class="report-category-filter__tools"><button type="button" data-report-filter-action="all">全选</button><button type="button" data-report-filter-action="clear">清除</button></div>
      <div class="report-category-filter__options">
        ${options.map((option) => `<label data-report-filter-row><input type="checkbox" value="${escapeHtml(option)}" data-report-filter-option="${kind}" ${draft.has(option) ? "checked" : ""} /><span>${escapeHtml(option)}</span></label>`).join("")}
      </div>
    </div>
  </details>`;
}

function reportCategoryBlock(category) {
  return `<article class="report-category-block">
    <div class="report-category-block__title"><strong>${escapeHtml(category.category)}</strong><span>${escapeHtml(category.status_label || category.group_label)}</span></div>
    ${reportTable(category.compare)}
    ${reportTable(category.period_data, "period")}
    <div class="report-conclusion"><strong>数据分析</strong><p>${escapeHtml(reportConclusionText(category.conclusion) || "暂无数据分析")}</p></div>
  </article>`;
}

function reportFilteredCategories(report, group) {
  const selectedCategories = state.ui.reportCategoriesApplied;
  const selectedOwners = state.ui.reportOwnersApplied;
  const ownerData = reportOwnerData(report);
  return (report.categories || []).filter((category) => category.group === group
    && selectedCategories.has(category.category)
    && [...(ownerData.categoryOwners.get(category.category) || [])].some((owner) => selectedOwners.has(owner)));
}

function reportCategorySection(report, group, id, title) {
  const categories = reportFilteredCategories(report, group);
  if (!categories.length) return "";
  return `<section class="dashboard-section report-section" id="${escapeHtml(id)}">
    ${sectionHead(title, "", `${categories.length} 个品类`)}
    ${categories.map(reportCategoryBlock).join("")}
  </section>`;
}

function reportBatchMonitorSection(report) {
  const monitor = report.batch_monitor;
  const tables = monitor?.tables || [monitor?.change, monitor?.rate, monitor?.period_data].filter((table) => table?.rows?.length);
  if (!tables.length) return "";
  const groups = monitor?.groups || [];
  const body = groups.length
    ? groups.map((group) => `<article class="report-category-block report-batch-block">
        <div class="report-category-block__title"><strong>${escapeHtml(group.title)}</strong></div>
        ${(group.tables || []).map((table) => reportTable(table, "period")).join("")}
      </article>`).join("")
    : tables.map((table) => reportTable(table, "period")).join("");
  return `<section class="dashboard-section report-section" id="report-batch-monitor">
    ${sectionHead("批量广告异常监测", monitor.title || "批量广告异常清单。", `${tables.reduce((count, table) => count + table.rows.length, 0)} 条`)}
    ${body}
  </section>`;
}

function reportDisplaySelfSections(report) {
  const sectionsByKey = new Map();
  (report.self_sections || []).forEach((section) => {
    if (report.report_type === "weekly" && sectionsByKey.has(section.key)) return;
    sectionsByKey.set(section.key, section);
  });
  return [...sectionsByKey.values()].map((section) => {
    if (section.key !== "sb") return section;
    const headers = section.table?.headers || [];
    const subTagIndex = headers.indexOf("子标签");
    if (subTagIndex < 0) return section;
    return {
      ...section,
      table: {
        ...section.table,
        rows: (section.table.rows || []).filter((row) => !["SB-PT", "SB-KAX"].includes(String(row[subTagIndex] || "").trim())),
      },
    };
  });
}

function renderWeekly() {
  if (!state.weeklyReport) {
    const detail = state.weeklyLoadError ? `（${state.weeklyLoadError}）` : "";
    root.innerHTML = emptyState(`尚未读取到月报 JSON ${detail}`);
    return;
  }
  const { reports, months, weeks, report } = ensureReportSelection();
  if (!report) {
    root.innerHTML = emptyState("data 文件夹中还没有可展示的月报");
    return;
  }
  const selfSections = reportDisplaySelfSections(report);
  const activeSelf = selfSections.find((section) => section.key === state.ui.weeklySelfTab) || selfSections[0] || {};
  const selfTabs = selfSections.map((section) => [section.key, section.title]);
  const periodLabel = `${report.current_period} vs ${report.previous_period}`;
  const warningMarkup = (report.warnings || []).map((warning) => `<p class="report-warning">${escapeHtml(warning)}</p>`).join("");

  const isWeekly = report.report_type === "weekly";
  const typeOptions = [["monthly", "月报"], ["weekly", "周报"]]
    .filter(([value]) => reports.some((item) => item.report_type === value));
  const reportTitle = isWeekly ? "亚马逊广告周报" : "亚马逊广告月报";
  const reportDescription = isWeekly
    ? "展示本次周报中的运营调整需关注、指定品类与自投数据，非指定品类不展示。"
    : "展示本次月报中的需关注、指定品类与自投数据，coupon 和促销异常中的指定品类仍归入“指定”。";

  root.innerHTML = `
    ${introMarkup(reportTitle, reportDescription, isWeekly ? `${report.month_label} ${report.week_label}` : report.month_label || periodLabel, `来源：${report.source_file}`)}
    <div class="report-filter-bar ${isWeekly ? "" : "report-filter-bar--monthly"}">
      ${reportSelect("报告类型", "type", typeOptions, state.ui.reportType)}
      ${reportSelect("报告月份", "month", months, state.ui.reportMonth)}
      ${isWeekly ? reportSelect("报告周次", "week", weeks, state.ui.reportWeek) : ""}
      ${reportMultiFilter(report, "owner")}
      ${reportMultiFilter(report, "category")}
      <div class="report-filter-actions"><button type="button" class="button button--primary" data-report-category-apply>查询</button><button type="button" class="button" data-report-category-reset>重置</button></div>
    </div>
    ${warningMarkup}
    ${reportCategorySection(report, "attention", "report-attention", "需关注")}
    ${reportCategorySection(report, "required", "report-required", "指定")}
    ${isWeekly ? reportBatchMonitorSection(report) : ""}
    <section class="dashboard-section report-section" id="report-self-invest">
      ${sectionHead("自投", "按 Excel 中的自投、优势引流、自动捡漏、SB、SD 板块切换。", `${activeSelf.table?.rows?.length || 0} 条`)}
      ${segmentControl("report-self-invest", selfTabs, activeSelf.key)}
      ${activeSelf.common ? `<div class="report-note"><strong>共性特征</strong><p>${escapeHtml(activeSelf.common)}</p></div>` : ""}
      ${activeSelf.abnormal ? `<div class="report-note is-warning"><strong>异常表现</strong><p>${escapeHtml(activeSelf.abnormal)}</p></div>` : ""}
      ${reportTable(activeSelf.table, "period")}
      ${activeSelf.analysis ? `<div class="report-note"><strong>数据分析</strong><p>${escapeHtml(activeSelf.analysis)}</p></div>` : ""}
    </section>`;
  window.requestAnimationFrame(syncReportTableWidths);
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))]
    .sort((a, b) => String(a).localeCompare(String(b), "zh-CN"));
}

function cloneSet(set) {
  return new Set([...set]);
}

const SHARED_FILTER_PAGES = new Set([
  "monthly_review",
  "invalid_low_efficiency",
  "lingxing_rules",
  "batch_launch",
]);

function applySharedFiltersToPage(pageId, configs) {
  if (!SHARED_FILTER_PAGES.has(pageId) || !state.filterDraft[pageId]) return;
  const ownerConfig = configs.find((config) => config.id === "owner");
  if (ownerConfig) {
    const owners = sharedSelection(unique(ownerConfig.options), "owner");
    state.filterDraft[pageId].owner = cloneSet(owners);
    state.filterApplied[pageId].owner = cloneSet(owners);
  }
  const categoryConfig = configs.find((config) => config.id === "category");
  if (categoryConfig) {
    const availableCategories = filterOptions(pageId, categoryConfig, true);
    const categories = sharedSelection(availableCategories, "category");
    state.filterDraft[pageId].category = cloneSet(categories);
    state.filterApplied[pageId].category = cloneSet(categories);
  }
}

function markSharedFilterDirty(pageId, filterId) {
  if (!SHARED_FILTER_PAGES.has(pageId) || !["owner", "category"].includes(filterId)) return;
  state.sharedFilterDirty.add(filterId);
  if (filterId === "owner") state.sharedFilterDirty.add("category");
}

function syncSharedFiltersToDestination(pageId) {
  if (pageId === "weekly_review") {
    state.ui.reportSelectionId = "";
    const report = ensureReportSelection().report;
    if (report) syncReportFiltersFromShared(report);
    return;
  }
  if (!SHARED_FILTER_PAGES.has(pageId)) return;
  const configs = pageFilterConfigs(pageId);
  initializeFilters(pageId, configs);
  applySharedFiltersToPage(pageId, configs);
}

function initializeFilters(pageId, configs) {
  if (state.filterDraft[pageId]) return;
  state.filterDraft[pageId] = {};
  state.filterApplied[pageId] = {};
  state.filterManual[pageId] = {};
  configs.forEach((config) => {
    const values = unique(config.options);
    state.filterDraft[pageId][config.id] = new Set(values);
    state.filterApplied[pageId][config.id] = new Set(values);
    state.filterManual[pageId][config.id] = false;
  });
  applySharedFiltersToPage(pageId, configs);
  state.searchDraft[pageId] = "";
  state.searchApplied[pageId] = "";
}

function selectedSet(pageId, id, draft = false) {
  const source = draft ? state.filterDraft : state.filterApplied;
  return source[pageId]?.[id] || new Set();
}

function filterOptions(pageId, config, draft = false) {
  const options = unique(config.options);
  if (!config.linkedTo || !config.ownerCategoryMap) return options;
  const selectedOwners = selectedSet(pageId, config.linkedTo, draft);
  if (selectedOwners.size === 0) return [];
  return options.filter((category) => {
    const categoryOwners = config.ownerCategoryMap.get(category) || new Set();
    return [...categoryOwners].some((owner) => selectedOwners.has(owner));
  });
}

function isAllSelected(pageId, config, draft = false) {
  const options = filterOptions(pageId, config, draft);
  const selected = selectedSet(pageId, config.id, draft);
  return selected.size === options.length && options.every((option) => selected.has(option));
}

function selectedLabel(pageId, config) {
  const set = selectedSet(pageId, config.id, true);
  const options = filterOptions(pageId, config, true);
  if (set.size === options.length && options.every((option) => set.has(option))) return "全部";
  if (set.size === 0) return "已清除";
  if (set.size === 1) return [...set][0];
  return `已选 ${set.size} 项`;
}

const MULTI_SELECT_SEARCH_THRESHOLD = 7;

function normalizeFuzzyText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/规则/g, "")
    .replace(/运营组长|组长|负责人/g, "")
    .replace(/[\s()（）[\]【】{}<>《》/\\._\-·]+/g, "");
}

function fuzzyOptionMatch(option, query) {
  const candidate = normalizeFuzzyText(option);
  const needle = normalizeFuzzyText(query);
  if (!needle) return true;
  if (candidate.includes(needle) || needle.includes(candidate)) return true;
  let matched = 0;
  for (const character of candidate) {
    if (character === needle[matched]) matched += 1;
    if (matched === needle.length) return true;
  }
  return false;
}

function multiSelectSearchMarkup(options) {
  if (options.length < MULTI_SELECT_SEARCH_THRESHOLD) return "";
  return `
    <div class="multi-select__search-wrap">
      <input class="multi-select__search" type="search" placeholder="搜索选项" aria-label="搜索筛选选项" autocomplete="off" />
      <span class="multi-select__search-count">${options.length} 项</span>
    </div>`;
}

function multiSelectMenuMarkup(options, selected) {
  return `
    ${multiSelectSearchMarkup(options)}
    <div class="multi-select__tools">
      <button type="button" class="link-button" data-select-action="all">全选</button>
      <button type="button" class="link-button" data-select-action="clear">清除</button>
    </div>
    <div class="multi-select__options">
      ${options.map((option) => `
        <label class="check-option">
          <input type="checkbox" value="${escapeHtml(option)}" ${selected.has(option) ? "checked" : ""} />
          <span>${escapeHtml(option)}</span>
        </label>`).join("")}
    </div>
    <div class="multi-select__empty is-hidden">未找到匹配选项</div>`;
}

function filterMarkup(pageId, configs, searchConfig = null, note = "") {
  initializeFilters(pageId, configs);
  const fields = configs.map((config) => {
    const options = filterOptions(pageId, config, true);
    const selected = selectedSet(pageId, config.id, true);
    return `
      <div class="filter-field">
        <span class="filter-field__label">${escapeHtml(config.label)}</span>
        <div class="multi-select" data-filter-id="${escapeHtml(config.id)}">
          <button type="button" class="multi-select__button" aria-expanded="false">
            ${escapeHtml(selectedLabel(pageId, config))}
          </button>
          <div class="multi-select__menu is-hidden">
            ${multiSelectMenuMarkup(options, selected)}
          </div>
        </div>
      </div>`;
  }).join("");

  const search = searchConfig ? `
    <div class="filter-field">
      <label for="${pageId}-search">${escapeHtml(searchConfig.label)}</label>
      <input class="search-input" id="${pageId}-search" type="search"
        placeholder="${escapeHtml(searchConfig.placeholder || "输入关键词")}" value="${escapeHtml(state.searchDraft[pageId] || "")}" />
    </div>` : "";

  return `
    <section class="filter-panel" data-page-filter="${pageId}">
      <div class="filter-panel__head">
        <h3>数据筛选</h3>
        <span class="filter-summary">${escapeHtml(note)}</span>
      </div>
      <div class="filter-grid">
        ${fields}
        ${search}
        <div class="filter-actions">
          <button type="button" class="button button--primary" data-filter-query>查询</button>
          <button type="button" class="button" data-filter-reset>重置</button>
        </div>
      </div>
    </section>`;
}

function batchOperationFilterMarkup(configs, note = "") {
  const pageId = "batch_operation_detail";
  initializeFilters(pageId, configs);
  const fields = configs.map((config) => {
    const options = filterOptions(pageId, config, true);
    const selected = selectedSet(pageId, config.id, true);
    return `
      <div class="filter-field">
        <span class="filter-field__label">${escapeHtml(config.label)}</span>
        <div class="multi-select" data-filter-id="${escapeHtml(config.id)}">
          <button type="button" class="multi-select__button" aria-expanded="false">
            ${escapeHtml(selectedLabel(pageId, config))}
          </button>
          <div class="multi-select__menu is-hidden">
            ${multiSelectMenuMarkup(options, selected)}
          </div>
        </div>
      </div>`;
  });
  const range = state.batchOperationDays;
  const appliedLabel = (() => {
    if (!range.minDraft && !range.maxDraft) return "全部";
    if (range.minDraft && range.maxDraft) return `${range.minDraft}天 - ${range.maxDraft}天`;
    if (range.minDraft) return `大于 ${range.minDraft} 天`;
    return `小于 ${range.maxDraft} 天`;
  })();
  fields.splice(1, 0, `
    <div class="filter-field batch-days-field">
      <span class="filter-field__label">上线天数</span>
      <div class="multi-select range-select" data-range-select="batch-operation-days">
        <button type="button" class="multi-select__button" aria-expanded="false">
          ${escapeHtml(appliedLabel)}
        </button>
        <div class="multi-select__menu range-select__menu is-hidden">
          <div class="range-select__body">
            <label>
              <span>大于</span>
              <input class="search-input" data-batch-days-min type="number" min="0" step="1"
                placeholder="天数" value="${escapeHtml(range.minDraft)}" />
            </label>
            <label>
              <span>小于</span>
              <input class="search-input" data-batch-days-max type="number" min="0" step="1"
                placeholder="天数" value="${escapeHtml(range.maxDraft)}" />
            </label>
          </div>
          <p class="range-select__hint">可只填一个，也可两个都填；点查询后生效。</p>
        </div>
      </div>
    </div>`);
  return `
    <section class="filter-panel batch-operation-filter" data-page-filter="${pageId}">
      <div class="filter-panel__head">
        <h3>数据筛选</h3>
        <span class="filter-summary">${escapeHtml(note)}</span>
      </div>
      <div class="filter-grid">
        ${fields.join("")}
        <div class="filter-actions">
          <button type="button" class="button button--primary" data-filter-query>查询</button>
          <button type="button" class="button" data-filter-reset>重置</button>
        </div>
      </div>
    </section>`;
}

function detailSearchMarkup(pageId, { label, placeholder }) {
  return `
    <div class="detail-search" data-page-filter="${escapeHtml(pageId)}">
      <div class="filter-field">
        <label for="${pageId}-detail-search">${escapeHtml(label)}</label>
        <input class="search-input" id="${pageId}-detail-search" type="search"
          placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(state.searchDraft[pageId] || "")}" />
      </div>
      <button type="button" class="button button--primary" data-filter-query>查询</button>
      <button type="button" class="button" data-search-clear>清除关键词</button>
    </div>`;
}

function invalidDetailFilterMarkup() {
  const pageId = "invalid_low_efficiency";
  const range = state.invalidDetailDays;
  return `
    <div class="detail-search invalid-detail-combined-filter"
      data-page-filter="${pageId}" data-invalid-detail-filter>
      <div class="filter-field invalid-detail-keyword-field">
        <label for="${pageId}-detail-search">广告活动关键词</label>
        <input class="search-input" id="${pageId}-detail-search" data-invalid-detail-keyword type="search"
          placeholder="搜索广告活动、广告组合或标签"
          value="${escapeHtml(state.invalidDetailSearch.draft)}" />
      </div>
      <div class="filter-field">
        <label for="invalid-days-min">投放天数大于</label>
        <input class="search-input" id="invalid-days-min" data-invalid-days-min type="number"
          min="0" step="1" placeholder="输入天数" value="${escapeHtml(range.minDraft)}" />
      </div>
      <div class="filter-field">
        <label for="invalid-days-max">投放天数小于</label>
        <input class="search-input" id="invalid-days-max" data-invalid-days-max type="number"
          min="0" step="1" placeholder="输入天数" value="${escapeHtml(range.maxDraft)}" />
      </div>
      <button type="button" class="button button--primary" data-invalid-detail-query>查询</button>
      <button type="button" class="button" data-invalid-detail-clear>清除</button>
      <span class="invalid-detail-filter__note">关键词和投放天数仅应用于本明细及下载结果</span>
    </div>`;
}

function initializeDetailFilter(filterId, options) {
  if (state.detailFilters[filterId]) return state.detailFilters[filterId];
  const values = [...new Set(options.filter((value) => value !== null && value !== undefined && value !== ""))];
  state.detailFilters[filterId] = {
    options: values,
    ruleDraft: new Set(values),
    ruleApplied: new Set(values),
    searchDraft: "",
    searchApplied: "",
  };
  return state.detailFilters[filterId];
}

function detailSelectedLabel(detailState) {
  if (detailState.ruleDraft.size === detailState.options.length) return "全部";
  if (detailState.ruleDraft.size === 0) return "已清除";
  if (detailState.ruleDraft.size === 1) return [...detailState.ruleDraft][0];
  return `已选 ${detailState.ruleDraft.size} 项`;
}

function detailFilterMarkup(filterId, { options, searchLabel, placeholder }) {
  const detailState = initializeDetailFilter(filterId, options);
  return `
    <div class="detail-search detail-filter-bar" data-detail-filter="${escapeHtml(filterId)}">
      <div class="filter-field">
        <span class="filter-field__label">规则类别（多选）</span>
        <div class="multi-select" data-filter-id="rule">
          <button type="button" class="multi-select__button" aria-expanded="false">${escapeHtml(detailSelectedLabel(detailState))}</button>
          <div class="multi-select__menu is-hidden">
            ${multiSelectSearchMarkup(detailState.options)}
            <div class="multi-select__tools">
              <button type="button" class="link-button" data-select-action="all">全选</button>
              <button type="button" class="link-button" data-select-action="clear">清除</button>
            </div>
            <div class="multi-select__options">
              ${detailState.options.map((option) => `
                <label class="check-option">
                  <input type="checkbox" value="${escapeHtml(option)}" ${detailState.ruleDraft.has(option) ? "checked" : ""} />
                  <span>${escapeHtml(option)}</span>
                </label>`).join("")}
            </div>
            <div class="multi-select__empty is-hidden">未找到匹配选项</div>
          </div>
        </div>
      </div>
      <div class="filter-field">
        <label for="${escapeHtml(filterId)}-detail-search">${escapeHtml(searchLabel)}</label>
        <input class="search-input" id="${escapeHtml(filterId)}-detail-search" type="search"
          placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(detailState.searchDraft)}" />
      </div>
      <button type="button" class="button button--primary" data-detail-query>查询</button>
      <button type="button" class="button" data-detail-search-clear>清除关键词</button>
    </div>`;
}

function detailSearchMatches(filterId, row, fields) {
  const query = (state.detailFilters[filterId]?.searchApplied || "").trim().toLowerCase();
  if (!query) return true;
  return fields.some((field) => String(row[field] ?? "").toLowerCase().includes(query));
}

function rowMatches(pageId, row, mapping) {
  return Object.entries(mapping).every(([filterId, field]) => {
    const set = selectedSet(pageId, filterId);
    return set.size > 0 && set.has(row[field]);
  });
}

function allFiltersAtDefault(pageId, configs) {
  return configs.every((config) => isAllSelected(pageId, config));
}

function searchMatches(pageId, row, fields) {
  const query = (state.searchApplied[pageId] || "").trim().toLowerCase();
  if (!query) return true;
  return fields.some((field) => String(row[field] ?? "").toLowerCase().includes(query));
}

function legendMarkup(previousLabel = "5月", currentLabel = "6月") {
  return `<div class="legend">
    <span class="legend-item"><i class="legend-swatch"></i>${escapeHtml(previousLabel)}</span>
    <span class="legend-item"><i class="legend-swatch is-current"></i>${escapeHtml(currentLabel)}</span>
  </div>`;
}

function compareList(rows, options = {}) {
  if (!rows.length) return emptyState();
  const previousVisible = options.previousVisible !== false;
  const currentVisible = options.currentVisible !== false;
  return `<div class="compare-list ${options.wrapLabels ? "compare-list--wrap-labels" : ""}">${rows.map((row) => {
    const previous = asNumber(row.previous);
    const current = asNumber(row.current);
    const max = Math.max(Math.abs(previous), Math.abs(current), 1);
    const formatter = row.formatter || ((value) => formatNumber(value, 2));
    return `
      <div class="compare-row">
        <div class="compare-row__label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</div>
        <div class="compare-bars">
          ${previousVisible ? `<div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, Math.abs(previous) / max * 100))}%"></div></div>` : ""}
          ${currentVisible ? `<div class="bar-track"><div class="bar-fill is-current" style="width:${Math.max(0, Math.min(100, Math.abs(current) / max * 100))}%"></div></div>` : ""}
        </div>
        <div class="compare-values">
          ${previousVisible ? `<span>${formatter(previous)}</span>` : ""}
          ${currentVisible ? `<strong>${formatter(current)}</strong>` : ""}
        </div>
      </div>`;
  }).join("")}</div>`;
}

function verticalCompareChart(rows, options = {}) {
  if (!rows.length) return emptyState();
  const previousVisible = options.previousVisible !== false;
  const currentVisible = options.currentVisible !== false;
  const values = rows.flatMap((row) => [asNumber(row.previous), asNumber(row.current)]);
  const max = Math.max(...values.map(Math.abs), 1);
  const scaleMax = options.scaleMax ? asNumber(options.scaleMax) : max / (options.maxFillRatio || 0.86);
  const formatter = options.formatter || ((value) => formatCompact(value));
  const chart = `<div class="vertical-chart ${escapeHtml(options.className || "")}">${rows.map((row) => {
    const previous = asNumber(row.previous);
    const current = asNumber(row.current);
    const previousLabelClass = options.staggerLabelsByValue && previous >= current ? "is-label-high" : "";
    const currentLabelClass = options.staggerLabelsByValue && current > previous ? "is-label-high" : "";
    return `
      <div class="vertical-group">
        <div class="vertical-bars">
          ${previousVisible ? `<div class="vertical-bar ${previousLabelClass}" style="height:${Math.max(2, Math.abs(previous) / scaleMax * 100)}%"><span>${formatter(previous)}</span></div>` : ""}
          ${currentVisible ? `<div class="vertical-bar is-current ${currentLabelClass}" style="height:${Math.max(2, Math.abs(current) / scaleMax * 100)}%"><span>${formatter(current)}</span></div>` : ""}
        </div>
        <div class="vertical-group__label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</div>
      </div>`;
  }).join("")}</div>`;
  if (!options.showYAxis) return chart;
  const axisFormatter = options.axisFormatter || formatter;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return `<div class="vertical-chart-frame">
    <div class="vertical-axis" aria-hidden="true">
      ${ticks.map((ratio) => `<span style="bottom:${ratio * 100}%">${axisFormatter(scaleMax * ratio)}</span>`).join("")}
    </div>
    ${chart}
  </div>`;
}

function horizontalBarChart(rows, options = {}) {
  if (!rows.length) return emptyState();
  const max = options.max || Math.max(...rows.map((row) => Math.abs(asNumber(row.value))), 1);
  const formatter = options.formatter || ((value) => formatNumber(value, 2));
  const axisFormatter = options.axisFormatter || formatter;
  const axis = options.showAxis ? `<div class="chart-axis chart-axis--hbar">
    <span></span>
    <div class="chart-axis__ticks">${[0, 0.25, 0.5, 0.75, 1].map((ratio) => `<span style="left:${ratio * 100}%">${axisFormatter(max * ratio)}</span>`).join("")}</div>
    <span></span>
  </div>` : "";
  return `<div class="hbar-chart">${axis}${rows.map((row) => `
    <div class="hbar-row">
      <div class="hbar-row__label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(0, Math.min(100, Math.abs(asNumber(row.value)) / max * 100))}%"></div></div>
      <div class="hbar-value">${formatter(row.value)}</div>
    </div>`).join("")}</div>`;
}

function dumbbellChart(rows, options = {}) {
  if (!rows.length) return emptyState();
  const isValid = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && (!options.hideNonPositive || Number(value) > 0);
  const allValues = rows.flatMap((row) => [row.previous, row.current]).filter(isValid).map(Number);
  const min = options.min ?? Math.min(0, ...allValues);
  const max = options.max ?? Math.max(...allValues, 1);
  const range = max - min || 1;
  const formatter = options.formatter || ((value) => formatNumber(value, 2));
  const differenceFormatter = options.differenceFormatter || formatter;
  const axisFormatter = options.axisFormatter || formatter;
  const valueLabels = options.valueLabels || ["批量", "品类平均", "差值"];
  const axisTrack = options.adaptiveRowScale
    ? '<div class="adaptive-axis">各行按自身 ACoS 区间自适应缩放</div>'
    : `<div class="chart-axis__ticks">${[0, 0.25, 0.5, 0.75, 1].map((ratio) => `<span style="left:${ratio * 100}%">${axisFormatter(min + range * ratio)}</span>`).join("")}</div>`;
  const axis = options.showAxis ? `<div class="chart-axis chart-axis--dumbbell">
    <span></span>
    ${axisTrack}
    <div class="dumbbell-axis__values"><span>${escapeHtml(valueLabels[0])}</span><span>${escapeHtml(valueLabels[1])}</span><strong>${escapeHtml(valueLabels[2])}</strong></div>
  </div>` : "";
  return `<div class="dumbbell-chart">${axis}${rows.map((row) => {
    const previousValid = isValid(row.previous);
    const currentValid = isValid(row.current);
    const previous = previousValid ? Number(row.previous) : null;
    const current = currentValid ? Number(row.current) : null;
    const difference = previousValid && currentValid
      ? (row.difference === undefined ? current - previous : Number(row.difference))
      : null;
    let previousPos = previousValid ? (previous - min) / range * 100 : 0;
    let currentPos = currentValid ? (current - min) / range * 100 : 0;
    if (options.adaptiveRowScale) {
      if (previousValid && currentValid) {
        const rowMinimum = Math.min(previous, current);
        const rowMaximum = Math.max(previous, current);
        const delta = rowMaximum - rowMinimum;
        const padding = Math.max(delta * 0.5, rowMaximum * 0.01, options.adaptiveMinPadding || 0.05);
        const rowMin = Math.max(options.adaptiveFloor ?? -Infinity, rowMinimum - padding);
        const rowMax = rowMaximum + padding;
        const rowRange = rowMax - rowMin || 1;
        previousPos = (previous - rowMin) / rowRange * 100;
        currentPos = (current - rowMin) / rowRange * 100;
      } else {
        previousPos = previousValid ? 50 : 0;
        currentPos = currentValid ? 50 : 0;
      }
    }
    const overlap = previousValid && currentValid && Math.abs(previousPos - currentPos) < 2;
    const left = Math.min(previousPos, currentPos);
    const width = Math.abs(previousPos - currentPos);
    let differenceClass = difference === null ? "is-neutral" : difference > 0 ? "is-good" : difference < 0 ? "is-bad" : "is-neutral";
    if (options.differenceTone === "higher-is-bad") differenceClass = difference > 0 ? "is-bad" : "is-dark";
    return `
      <div class="dumbbell-row">
        <div class="dumbbell-row__label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</div>
        <div class="dumbbell-track">
          ${previousValid && currentValid ? `<span class="dumbbell-line" style="left:${left}%;width:${width}%"></span>` : ""}
          ${previousValid ? `<span class="dumbbell-dot ${overlap ? "is-offset-up" : ""}" style="left:${previousPos}%"></span>` : ""}
          ${currentValid ? `<span class="dumbbell-dot is-current ${overlap ? "is-offset-down" : ""}" style="left:${currentPos}%"></span>` : ""}
        </div>
        <div class="dumbbell-values">
          <span>${previousValid ? formatter(previous) : "-"}</span>
          <span>${currentValid ? formatter(current) : "-"}</span>
          <strong class="acos-difference ${differenceClass}">${difference === null ? "-" : differenceFormatter(difference)}</strong>
        </div>
      </div>`;
  }).join("")}</div>`;
}

function numericComparisonTable(rows, options = {}) {
  if (!rows.length) return emptyState();
  const formatter = options.formatter || ((value) => formatNumber(value, 2));
  const differenceFormatter = options.differenceFormatter || formatter;
  const labels = options.valueLabels || ["5月", "6月", "变化"];
  return `<div class="numeric-compare-table">
    <div class="numeric-compare-row is-header">
      <span>运营组长</span><span>${escapeHtml(labels[0])}</span><span>${escapeHtml(labels[1])}</span><span>${escapeHtml(labels[2])}</span>
    </div>
    ${rows.map((row) => {
      const previous = asNumber(row.previous);
      const current = asNumber(row.current);
      const difference = row.difference === undefined ? current - previous : asNumber(row.difference);
      const differenceClass = options.differenceTone === "higher-is-bad"
        ? (difference > 0 ? "is-bad" : difference < 0 ? "is-dark" : "is-neutral")
        : (difference > 0 ? "is-good" : difference < 0 ? "is-bad" : "is-neutral");
      return `<div class="numeric-compare-row">
        <strong>${escapeHtml(row.label)}</strong>
        <span class="is-previous">${formatter(previous)}</span>
        <span class="is-current">${formatter(current)}</span>
        <span class="acos-difference ${differenceClass}">${differenceFormatter(difference)}</span>
      </div>`;
    }).join("")}
  </div>`;
}

function triggerReason(row) {
  const previous = asNumber(row.上周期触发次数);
  const current = asNumber(row.本周期触发次数);
  if (current > previous) return "规则触发次数大幅增长";
  if (current < previous) return "规则触发次数大幅下降";
  return "规则触发次数变化较大";
}

function niceFractionMax(values) {
  const maximum = Math.max(...values.map((value) => Math.max(0, asNumber(value))), 0);
  const percent = maximum * 100;
  const step = percent <= 20 ? 5 : percent <= 50 ? 10 : 20;
  return Math.min(1, Math.max(step / 100, Math.ceil(percent / step) * step / 100));
}

function formatSignedFractionPercent(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = asNumber(value) * 100;
  const sign = number > 0 ? "+" : number < 0 ? "-" : "";
  return `${sign}${formatNumber(Math.abs(number), 2)}%`;
}

function formatSignedPercentPoints(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = asNumber(value);
  const sign = number > 0 ? "+" : number < 0 ? "-" : "";
  return `${sign}${formatNumber(Math.abs(number), 2)}%`;
}

function segmentControl(id, options, active) {
  return `<div class="segment-control" data-segment="${escapeHtml(id)}">${options.map(([value, label]) => `
    <button type="button" class="segment-button ${value === active ? "is-active" : ""}" data-segment-value="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join("")}</div>`;
}

function tagMarkup(value) {
  const text = String(value ?? "-");
  let className = "";
  if (["异常升高", "严重异常", "无效", "超预算", "广告活动超预算", "广告组合超预算"].includes(text)) className = "is-danger";
  if (["异常", "触发偏低", "触发次数变化较大", "低效", "广告活动已暂停"].includes(text)) className = "is-warning";
  if (["正常", "投放中"].includes(text)) className = "is-good";
  return `<span class="tag ${className}">${escapeHtml(text)}</span>`;
}

function tableMarkup(id, rows, columns, pageSize = 50) {
  if (!rows.length) return `<div class="table-shell">${emptyState()}</div>`;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(state.pagination[id] || 1, totalPages);
  state.pagination[id] = currentPage;
  const start = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const head = columns.map((column) => `<th class="${column.numeric ? "cell-number" : ""}">${escapeHtml(column.label)}</th>`).join("");
  const body = pageRows.map((row) => `<tr>${columns.map((column) => {
    let content;
    if (column.render) content = column.render(row[column.field], row);
    else content = escapeHtml(row[column.field] ?? "-");
    const classes = [
      column.numeric ? "cell-number" : "",
      column.long ? "cell-long" : "",
      column.wrap ? "cell-wrap" : "",
    ].filter(Boolean).join(" ");
    return `<td class="${classes}">${content}</td>`;
  }).join("")}</tr>`).join("");
  return `
    <div class="table-shell" data-table-id="${escapeHtml(id)}">
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <div class="table-footer">
        <span>共 ${formatNumber(rows.length, 0)} 条，第 ${currentPage} / ${totalPages} 页</span>
        <div class="pagination">
          <button type="button" class="page-button" data-page-action="prev" ${currentPage <= 1 ? "disabled" : ""}>上一页</button>
          <button type="button" class="page-button" data-page-action="next" ${currentPage >= totalPages ? "disabled" : ""}>下一页</button>
        </div>
      </div>
    </div>`;
}

function aggregateBy(rows, keyField, aggregators) {
  const map = new Map();
  rows.forEach((row) => {
    const key = row[keyField] || "未分类";
    if (!map.has(key)) map.set(key, { [keyField]: key });
    const target = map.get(key);
    Object.entries(aggregators).forEach(([name, getter]) => {
      target[name] = asNumber(target[name]) + asNumber(getter(row));
    });
  });
  return [...map.values()];
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 1800);
}

function categoryOwnerMap(rows, categoryField, ownerField, splitter = null) {
  const mapping = new Map();
  rows.forEach((row) => {
    const owner = row[ownerField];
    const categories = splitter
      ? String(row[categoryField] || "").split(splitter).map((value) => value.trim()).filter(Boolean)
      : [row[categoryField]];
    categories.forEach((category) => {
      if (!category || !owner) return;
      if (!mapping.has(category)) mapping.set(category, new Set());
      mapping.get(category).add(owner);
    });
  });
  return mapping;
}

function monthlyFilterConfig(data) {
  const ownerCategoryMap = categoryOwnerMap(data.category_overview || [], "品类", "运营组长");
  return [
    { id: "owner", label: "运营组长", options: data.filters?.运营组长 || data.category_overview.map((row) => row.运营组长) },
    { id: "category", label: "业务品类", options: data.filters?.品类 || data.category_overview.map((row) => row.品类), linkedTo: "owner", ownerCategoryMap },
  ];
}

function formatMonth(value) {
  const text = String(value || "");
  return /^\d{6}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4)}` : text;
}

function monthlyDataModel(data, configs) {
  const currentRows = data.category_overview.filter((row) => rowMatches("monthly_review", row, {
    category: "品类",
    owner: "运营组长",
  }));
  const compareRows = data.category_compare.filter((row) => rowMatches("monthly_review", row, {
    category: "品类",
    owner: "运营组长",
  }));
  const current = {
    impressions: sum(currentRows, "总曝光量"),
    clicks: sum(currentRows, "总点击量"),
    spend: sum(currentRows, "总花费"),
    sales: sum(currentRows, "总销售额"),
    orders: sum(currentRows, "总订单量"),
  };
  const previous = compareRows.reduce((metrics, row) => {
    const spend = asNumber(row["上月_总花费"]);
    const acos = asNumber(row["上月_ACoS(%)"]);
    const cpc = asNumber(row["上月_CPC"]);
    metrics.impressions += asNumber(row["上月_总曝光量"]);
    metrics.clicks += cpc ? spend / cpc : 0;
    metrics.spend += spend;
    metrics.sales += acos ? spend / (acos / 100) : 0;
    metrics.orders += asNumber(row["上月_总订单量"]);
    return metrics;
  }, { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 });

  const overview = Object.fromEntries(data.overview.map((row) => [row.指标, row]));
  if (allFiltersAtDefault("monthly_review", configs)) {
    previous.impressions = asNumber(overview.总曝光量?.上月);
    current.impressions = asNumber(overview.总曝光量?.本月);
    previous.clicks = asNumber(overview.总点击量?.上月);
    current.clicks = asNumber(overview.总点击量?.本月);
    previous.spend = asNumber(overview.总花费?.上月);
    current.spend = asNumber(overview.总花费?.本月);
    previous.sales = asNumber(overview.总销售额?.上月);
    current.sales = asNumber(overview.总销售额?.本月);
    previous.orders = asNumber(overview.总订单量?.上月);
    current.orders = asNumber(overview.总订单量?.本月);
  }

  [previous, current].forEach((metrics) => {
    metrics.ctr = safeDivide(metrics.clicks, metrics.impressions) * 100;
    metrics.cpc = safeDivide(metrics.spend, metrics.clicks);
    metrics.acos = safeDivide(metrics.spend, metrics.sales) * 100;
    metrics.cvr = safeDivide(metrics.orders, metrics.clicks) * 100;
    metrics.cpa = safeDivide(metrics.spend, metrics.orders);
  });
  if (allFiltersAtDefault("monthly_review", configs)) {
    previous.ctr = asNumber(overview["CTR(%)"]?.上月);
    current.ctr = asNumber(overview["CTR(%)"]?.本月);
    previous.cpc = asNumber(overview.CPC?.上月);
    current.cpc = asNumber(overview.CPC?.本月);
    previous.acos = asNumber(overview["ACoS(%)"]?.上月);
    current.acos = asNumber(overview["ACoS(%)"]?.本月);
    previous.cvr = asNumber(overview["CVR(%)"]?.上月);
    current.cvr = asNumber(overview["CVR(%)"]?.本月);
  }
  return { currentRows, compareRows, current, previous };
}

function monthlyCategoryRows(model) {
  const currentMap = new Map(model.currentRows.map((row) => [row.品类, row]));
  return model.compareRows.map((row) => {
    const current = currentMap.get(row.品类) || {};
    const previousSpend = asNumber(row["上月_总花费"]);
    const previousAcos = asNumber(row["上月_ACoS(%)"]);
    return {
      品类: row.品类,
      运营组长: row.运营组长,
      上月花费: previousSpend,
      本月花费: asNumber(row["本月_总花费"]),
      上月销售额: previousAcos ? previousSpend / (previousAcos / 100) : 0,
      本月销售额: asNumber(current.总销售额),
      上月订单量: asNumber(row["上月_总订单量"]),
      本月订单量: asNumber(row["本月_总订单量"]),
      上月ACOS: previousAcos,
      本月ACOS: asNumber(row["本月_ACoS(%)"]),
      上月CPC: asNumber(row["上月_CPC"]),
      本月CPC: asNumber(row["本月_CPC"]),
      上月CVR: asNumber(row["上月_CVR(%)"]),
      本月CVR: asNumber(row["本月_CVR(%)"]),
    };
  });
}

function renderMonthly() {
  const data = state.data.monthly_review;
  const configs = monthlyFilterConfig(data);
  initializeFilters("monthly_review", configs);
  const model = monthlyDataModel(data, configs);
  const categoryRows = monthlyCategoryRows(model);
  const hasData = model.currentRows.length > 0 || model.compareRows.length > 0;
  const kpis = hasData ? [
    kpiCard({ label: "总花费", value: model.current.spend, previous: model.previous.spend, valueType: "currency", tone: "primary", inverse: true }),
    kpiCard({ label: "总销售额", value: model.current.sales, previous: model.previous.sales, valueType: "currency", tone: "teal" }),
    kpiCard({ label: "总订单量", value: model.current.orders, previous: model.previous.orders, valueType: "integer", tone: "orange" }),
    kpiCard({ label: "ACoS", value: model.current.acos, previous: model.previous.acos, valueType: "percent", tone: "red", inverse: true }),
    kpiCard({ label: "CTR", value: model.current.ctr, previous: model.previous.ctr, valueType: "percent", tone: "green" }),
  ].join("") : emptyState();

  const volumeRows = [
    { label: "总花费", previous: model.previous.spend, current: model.current.spend, formatter: (v) => formatCurrency(v, true) },
    { label: "总销售额", previous: model.previous.sales, current: model.current.sales, formatter: (v) => formatCurrency(v, true) },
    { label: "总订单量", previous: model.previous.orders, current: model.current.orders, formatter: (v) => formatNumber(v, 0) },
    { label: "总点击量", previous: model.previous.clicks, current: model.current.clicks, formatter: (v) => formatCompact(v) },
    { label: "总曝光量", previous: model.previous.impressions, current: model.current.impressions, formatter: (v) => formatCompact(v) },
  ];
  const efficiencyRows = [
    { label: "CTR", previous: model.previous.ctr, current: model.current.ctr, formatter: (v) => formatPercent(v) },
    { label: "CVR", previous: model.previous.cvr, current: model.current.cvr, formatter: (v) => formatPercent(v) },
    { label: "ACoS", previous: model.previous.acos, current: model.current.acos, formatter: (v) => formatPercent(v) },
    { label: "CPC", previous: model.previous.cpc, current: model.current.cpc, formatter: (v) => formatCurrency(v) },
    { label: "CPA", previous: model.previous.cpa, current: model.current.cpa, formatter: (v) => formatCurrency(v) },
  ];

  const sortedBySpend = [...categoryRows].sort((a, b) => b.本月花费 - a.本月花费);
  const topCategories = sortedBySpend.slice(0, 15);
  const salesCategories = [...categoryRows].sort((a, b) => b.本月销售额 - a.本月销售额).slice(0, 15);
  const totalCategorySpend = sum(categoryRows, "本月花费");
  const spendChart = verticalCompareChart(topCategories.map((row) => ({ label: row.品类, previous: row.上月花费, current: row.本月花费 })), {
    formatter: (v) => formatCurrency(v, true),
    axisFormatter: (v) => formatCurrency(v, true),
    className: "vertical-chart--category",
    showYAxis: true,
    staggerLabelsByValue: true,
  });
  const salesChart = verticalCompareChart(salesCategories.map((row) => ({ label: row.品类, previous: row.上月销售额, current: row.本月销售额 })), {
    formatter: (v) => formatCurrency(v, true),
    axisFormatter: (v) => formatCurrency(v, true),
    className: "vertical-chart--category",
    showYAxis: true,
    staggerLabelsByValue: true,
  });
  const shareChart = horizontalBarChart(topCategories.map((row) => ({ label: row.品类, value: safeDivide(row.本月花费, totalCategorySpend) })), { max: niceFractionMax(topCategories.map((row) => safeDivide(row.本月花费, totalCategorySpend))), showAxis: true, formatter: (v) => formatPercent(v, true), axisFormatter: (v) => formatPercent(v, true, 0) });
  let categoryChart = "";
  let categoryTitle = "全部品类对比";
  if (state.ui.monthlyCategoryTab === "spend") {
    categoryTitle = "品类广告花费对比";
    categoryChart = spendChart;
  } else if (state.ui.monthlyCategoryTab === "sales") {
    categoryTitle = "品类广告销售额对比";
    categoryChart = salesChart;
  } else if (state.ui.monthlyCategoryTab === "share") {
    categoryTitle = "本月品类花费占比";
    categoryChart = shareChart;
  } else {
    categoryChart = `<div class="category-chart-stack">
      <div class="category-chart-block"><h4>花费对比</h4>${spendChart}</div>
      <div class="category-chart-block"><h4>销售额对比</h4>${salesChart}</div>
      <div class="category-chart-block"><h4>花费占比</h4>${shareChart}</div>
    </div>`;
  }

  const ownerRows = aggregateBy(categoryRows, "运营组长", {
    上月花费: (row) => row.上月花费,
    本月花费: (row) => row.本月花费,
    上月销售额: (row) => row.上月销售额,
    本月销售额: (row) => row.本月销售额,
    上月订单量: (row) => row.上月订单量,
    本月订单量: (row) => row.本月订单量,
  }).map((row) => ({
    ...row,
    上月ACOS: safeDivide(row.上月花费, row.上月销售额) * 100,
    本月ACOS: safeDivide(row.本月花费, row.本月销售额) * 100,
    花费环比: changeRate(row.本月花费, row.上月花费),
  })).sort((a, b) => b.本月花费 - a.本月花费);
  const categoryColumns = [
    { field: "品类", label: "品类" },
    { field: "运营组长", label: "运营组长" },
    { field: "上月花费", label: "6月花费", numeric: true, render: (v) => formatCurrency(v) },
    { field: "本月花费", label: "7月花费", numeric: true, render: (v) => formatCurrency(v) },
    { field: "上月销售额", label: "6月销售额", numeric: true, render: (v) => formatCurrency(v) },
    { field: "本月销售额", label: "7月销售额", numeric: true, render: (v) => formatCurrency(v) },
    { field: "上月订单量", label: "6月订单", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "本月订单量", label: "7月订单", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "上月ACOS", label: "6月 ACoS", numeric: true, render: (v) => formatPercent(v) },
    { field: "本月ACOS", label: "7月 ACoS", numeric: true, render: (v) => formatPercent(v) },
  ];
  const ownerColumns = [
    { field: "运营组长", label: "运营组长" },
    { field: "本月花费", label: "7月花费", numeric: true, render: (v) => formatCurrency(v) },
    { field: "本月销售额", label: "7月销售额", numeric: true, render: (v) => formatCurrency(v) },
    { field: "本月订单量", label: "7月订单", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "本月ACOS", label: "7月 ACoS", numeric: true, render: (v) => formatPercent(v) },
    { field: "花费环比", label: "花费环比", numeric: true, render: (v) => v === null ? "新增" : formatSignedFractionPercent(v) },
  ];
  const sbsdData = data.sbsd_share_analysis || { q3_allocation: { rows: [] }, july_spend: { rows: [] } };
  const q3Rows = sbsdData.q3_allocation?.rows || [];
  const julySpendRows = sbsdData.july_spend?.rows || [];
  const sbsdJulyColumns = [
    { field: "品类", label: "品类" },
    { field: "求和:花费", label: "花费", numeric: true, render: (v) => formatCurrency(v) },
    { field: "求和:广告销售额", label: "广告销售额", numeric: true, render: (v) => formatCurrency(v) },
    { field: "求和:广告订单", label: "广告订单", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "平均值:CVR", label: "CVR", numeric: true, render: (v) => formatPercent(v) },
    { field: "平均值:ACoS", label: "ACoS", numeric: true, render: (v) => formatPercent(v) },
  ];

  root.innerHTML = `
    ${introMarkup("月度广告数据复盘", "整体规模、效率变化及品类与运营组长表现，用于月度经营复盘。", "2026年6月 vs 7月")}
    <div class="kpi-grid">${kpis}</div>
    ${filterMarkup("monthly_review", configs, null, `${model.currentRows.length} 个品类`) }
    <section class="dashboard-section" id="monthly-overview">
      ${sectionHead("整体大盘", "规模与效率指标分别比较，避免不同单位混在同一坐标中。", "6月 vs 7月")}
      <div class="chart-grid">
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>规模指标对比</h4><p>花费、销售、订单、点击与曝光</p></div>${legendMarkup("6月", "7月")}</div>
          ${hasData ? compareList(volumeRows) : emptyState()}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>效率指标对比</h4><p>CTR、CVR、ACoS、CPC 与 CPA</p></div>${legendMarkup("6月", "7月")}</div>
          ${hasData ? compareList(efficiencyRows) : emptyState()}
        </div>
      </div>
    </section>
    <section class="dashboard-section" id="monthly-category">
      ${sectionHead("品类视角", "查看重点品类的花费、销售额、花费占比和 ACoS 变化。", `${categoryRows.length} 个品类`)}
      <div class="chart-title-row">
        <div><h4>${escapeHtml(categoryTitle)}</h4></div>
        ${segmentControl("monthly-category", [["all", "全部"], ["spend", "花费对比"], ["sales", "销售额对比"], ["share", "花费占比"]], state.ui.monthlyCategoryTab)}
      </div>
      <div class="chart-panel chart-panel--full">${categoryChart}</div>
      <div style="height:14px"></div>
      ${tableMarkup("monthly-category-table", sortedBySpend, categoryColumns, 30)}
    </section>
    <section class="dashboard-section" id="monthly-owner">
      ${sectionHead("运营组长视角", "按运营组长汇总负责品类的花费、销售、订单与 ACoS。", `${ownerRows.length} 位运营组长`)}
      <div class="chart-grid">
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>广告花费对比</h4></div>${legendMarkup("6月", "7月")}</div>
          ${verticalCompareChart(ownerRows.map((row) => ({ label: row.运营组长, previous: row.上月花费, current: row.本月花费 })), { formatter: (v) => formatCurrency(v, true) })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>ACoS 数值对比</h4><p>直接比较两个月数值及百分点变化</p></div></div>
          ${numericComparisonTable(ownerRows.map((row) => ({ label: row.运营组长, previous: row.上月ACOS, current: row.本月ACOS })), {
            valueLabels: ["6月", "7月", "变化"],
            formatter: (v) => formatPercent(v),
            differenceFormatter: formatSignedPercentPoints,
            differenceTone: "higher-is-bad",
          })}
        </div>
      </div>
      <div style="height:14px"></div>
      ${tableMarkup("monthly-owner-table", ownerRows, ownerColumns, 30)}
    </section>
    <section class="dashboard-section" id="monthly-sbsd-share">
      ${sectionHead("SBSD广告活动占比分析", "查看Q3预算分配策略与7月SDSB广告花费结构。左侧保留源表数据，右侧展示对应花费占比。", "数据源：SD广告花费占比分析.xlsx")}
      <div class="sbsd-analysis-grid">
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>${escapeHtml(sbsdData.q3_allocation?.title || "SDSB的Q3预算分配策略")}</h4><p>按源表左侧数据保留品类与预估预算分配</p></div></div>
          ${tableMarkup("sbsd-q3-table", q3Rows, [
            { field: "品类", label: "市占排名降序（25年全年测算）" },
            { field: "预估预算分配", label: "预估预算分配", numeric: true, render: (v) => formatPercent(v, true) },
          ], 30)}
          ${sbsdData.q3_allocation?.note ? `<div class="method-note">${escapeHtml(sbsdData.q3_allocation.note)}</div>` : ""}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>Q3预算分配占比</h4><p>沿用源表饼图，包含品类与占比标注</p></div></div>
          <img class="sbsd-source-chart" src="assets/sbsd-q3-allocation.png" alt="Q3预算分配占比饼图，包含品类与占比标注">
        </div>
      </div>
      <div class="sbsd-analysis-grid">
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>${escapeHtml(sbsdData.july_spend?.title || "7月月度花费占比")}</h4><p>展示源表第1—17行 A—F列区域（含总计）</p></div></div>
          ${tableMarkup("sbsd-july-table", julySpendRows, sbsdJulyColumns, 20)}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>7月SDSB花费占比</h4><p>沿用源表饼图，包含品类与占比标注</p></div></div>
          <img class="sbsd-source-chart" src="assets/sbsd-july-spend.png" alt="7月SDSB花费占比饼图，包含品类与占比标注">
        </div>
      </div>
    </section>`;
}

function invalidFilterConfig(data) {
  const ownerCategoryMap = categoryOwnerMap([
    ...(data.invalid_details || []),
    ...(data.inefficient_details || []),
    ...(data.savings_by_category || []),
  ], "父标签", "运营组长");
  return [
    { id: "owner", label: "运营组长", options: data.filters.运营组长 || [] },
    { id: "category", label: "品类", options: data.filters.品类 || [], linkedTo: "owner", ownerCategoryMap },
    { id: "adType", label: "广告类型", options: data.filters.广告类型 || [] },
    { id: "service", label: "服务状态", options: (data.filters.服务状态 || []).map(invalidServiceStatusLabel) },
  ];
}

function invalidServiceStatusLabel(value) {
  const text = String(value ?? "").trim();
  const labels = {
    CAMPAIGN_STATUS_ENABLED: "投放中",
    CAMPAIGN_OUT_OF_BUDGET: "预算耗尽",
    CAMPAIGN_STATUS_PAUSED: "已暂停",
    CAMPAIGN_PAUSED: "已暂停",
    CAMPAIGN_STATUS_ARCHIVED: "已归档",
    CAMPAIGN_STATUS_DISABLED: "已关闭",
    CAMPAIGN_STATUS_CLOSED: "已关闭",
    CAMPAIGN_STATUS_ENDED: "已结束",
    ENABLED: "投放中",
    PAUSED: "已暂停",
    ARCHIVED: "已归档",
  };
  return labels[text] || text || "未标记";
}

function filterInvalidDetail(rows) {
  return rows.map((row) => ({
    ...row,
    服务状态显示: invalidServiceStatusLabel(row.服务状态),
  })).filter((row) => rowMatches("invalid_low_efficiency", row, {
    category: "父标签",
    owner: "运营组长",
    adType: "类型",
    service: "服务状态显示",
  }));
}

function selectedInvalidDetailRows(invalidRows, inefficientRows) {
  const rows = [];
  if (state.ui.invalidDetailTab !== "inefficient") rows.push(...invalidRows);
  if (state.ui.invalidDetailTab !== "invalid") rows.push(...inefficientRows);
  const query = state.invalidDetailSearch.applied.trim().toLowerCase();
  const { minApplied, maxApplied } = state.invalidDetailDays;
  return rows.filter((row) => {
    if (query && !["广告活动", "广告组合", "标签"].some(
      (field) => String(row[field] ?? "").toLowerCase().includes(query),
    )) return false;
    if (minApplied === null && maxApplied === null) return true;
    const days = Number(row.投放天数);
    if (!Number.isFinite(days)) return false;
    if (minApplied !== null && days <= minApplied) return false;
    if (maxApplied !== null && days >= maxApplied) return false;
    return true;
  }).sort((a, b) => asNumber(b.花费) - asNumber(a.花费));
}

const INVALID_DETAIL_EXPORT_COLUMNS = [
  { field: "复盘标签", label: "复盘标签" },
  { field: "店铺名称", label: "店铺" },
  { field: "父标签", label: "品类" },
  { field: "运营组长", label: "运营组长" },
  { field: "类型", label: "广告类型" },
  { field: "服务状态显示", label: "服务状态" },
  { field: "投放天数", label: "投放天数", integer: true },
  { field: "广告活动", label: "广告活动" },
  { field: "花费", label: "花费", digits: 2 },
  { field: "曝光量", label: "曝光量", integer: true },
  { field: "点击", label: "点击", integer: true },
  { field: "广告订单", label: "广告订单", integer: true },
  { field: "广告销售额", label: "广告销售额", digits: 2 },
  { field: "ACoS", label: "ACoS" },
];

function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportDetailValue(row, column) {
  const value = row[column.field];
  if (column.integer) return Math.round(asNumber(value));
  if (column.digits !== undefined) return asNumber(value).toFixed(column.digits);
  return value ?? "";
}

function downloadInvalidDetailCsv() {
  const data = state.data?.invalid_low_efficiency;
  if (!data) return;
  const invalidRows = filterInvalidDetail(data.invalid_details || []);
  const inefficientRows = filterInvalidDetail(data.inefficient_details || []);
  const rows = selectedInvalidDetailRows(invalidRows, inefficientRows);
  if (!rows.length) {
    showToast("当前筛选条件下没有可下载的明细");
    return;
  }

  const header = INVALID_DETAIL_EXPORT_COLUMNS.map((column) => csvCell(column.label)).join(",");
  const body = rows.map((row) => INVALID_DETAIL_EXPORT_COLUMNS
    .map((column) => csvCell(exportDetailValue(row, column)))
    .join(","));
  const blob = new Blob([`\ufeff${[header, ...body].join("\r\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const scope = { all: "全部", invalid: "无效", inefficient: "低效" }[state.ui.invalidDetailTab] || "全部";
  const link = document.createElement("a");
  link.href = url;
  link.download = `无效低效广告活动明细_${scope}_${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  trackUsage("detail_download", {
    download_type: "invalid_low_efficiency_csv",
    result_count: rows.length,
  });
  showToast(`已下载 ${formatNumber(rows.length, 0)} 条明细`);
}

function renderInvalid() {
  const data = state.data.invalid_low_efficiency;
  const configs = invalidFilterConfig(data);
  initializeFilters("invalid_low_efficiency", configs);
  const invalidRows = filterInvalidDetail(data.invalid_details || []);
  const inefficientRows = filterInvalidDetail(data.inefficient_details || []);
  const savingDimensionDefault = isAllSelected("invalid_low_efficiency", configs[0]) && isAllSelected("invalid_low_efficiency", configs[1]);
  const filteredSavingsCategory = (data.savings_by_category || []).filter((row) => {
    if (savingDimensionDefault) return true;
    const categorySet = selectedSet("invalid_low_efficiency", "category");
    const ownerSet = selectedSet("invalid_low_efficiency", "owner");
    return categorySet.size > 0 && ownerSet.size > 0 && categorySet.has(row.父标签) && ownerSet.has(row.运营组长);
  });
  const filteredSavingsOwner = (data.savings_by_owner || []).filter((row) => savingDimensionDefault || selectedSet("invalid_low_efficiency", "owner").has(row.运营组长));
  const invalidSpend = sum(invalidRows, "花费");
  const inefficientSpend = sum(inefficientRows, "花费");
  const saving = savingDimensionDefault
    ? asNumber(data.totals["本月节约总广告花费"])
    : sum(filteredSavingsCategory, "节约广告花费");
  const totalSpend = asNumber(data.totals["本月总花费"]);
  const categoryInvalid = aggregateBy(invalidRows, "父标签", {
    广告活动数量: () => 1,
    总花费: (row) => row.花费,
    总曝光量: (row) => row.曝光量,
    总点击: (row) => row.点击,
  }).sort((a, b) => b.总花费 - a.总花费);
  const categoryInefficient = aggregateBy(inefficientRows, "父标签", {
    广告活动数量: () => 1,
    总花费: (row) => row.花费,
    总广告销售额: (row) => row.广告销售额,
    总广告订单: (row) => row.广告订单,
  }).map((row) => ({ ...row, 平均ACoS: safeDivide(row.总花费, row.总广告销售额) * 100 })).sort((a, b) => b.总花费 - a.总花费);

  const detailRows = selectedInvalidDetailRows(invalidRows, inefficientRows);

  const detailColumns = [
    { field: "复盘标签", label: "复盘标签", render: (v) => tagMarkup(v) },
    { field: "店铺名称", label: "店铺" },
    { field: "父标签", label: "品类" },
    { field: "运营组长", label: "运营组长" },
    { field: "类型", label: "广告类型" },
    { field: "服务状态显示", label: "服务状态", render: (v) => tagMarkup(v) },
    { field: "投放天数", label: "投放天数", numeric: true, render: (v) => `${formatNumber(v, 0)} 天` },
    { field: "广告活动", label: "广告活动", long: true },
    { field: "花费", label: "花费", numeric: true, render: (v) => formatCurrency(v) },
    { field: "曝光量", label: "曝光量", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "点击", label: "点击", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "广告订单", label: "广告订单", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "广告销售额", label: "广告销售额", numeric: true, render: (v) => formatCurrency(v) },
    { field: "ACoS", label: "ACoS", numeric: true, wrap: true },
  ];

  root.innerHTML = `
    ${introMarkup("无效低效广告复盘", "数据窗口：近30天（排除近两天），且广告活动创建满60天；无效：有效状态=enabled 且 花费≥0 且 订单=0；低效：有效状态=enabled 且 ACoS≥60%。", "2026年7月")}
    <div class="kpi-grid kpi-grid--six">
      ${kpiCard({ label: "无效广告活动", value: invalidRows.length, valueType: "integer", tone: "red", note: `花费 ${formatCurrency(invalidSpend)}` })}
      ${kpiCard({ label: "低效广告活动", value: inefficientRows.length, valueType: "integer", tone: "orange", note: `花费 ${formatCurrency(inefficientSpend)}` })}
      ${kpiCard({ label: "已节约广告花费", value: saving, valueType: "currency", tone: "green", note: "按品类与运营组长筛选" })}
      ${kpiCard({ label: "已节约占总花费比例", value: safeDivide(saving, totalSpend) * 100, valueType: "percent", tone: "teal", note: `本月总花费 ${formatCurrency(totalSpend, true)}` })}
      ${kpiCard({ label: "关停/归档活动", value: data.totals["本月关停/归档广告活动数量"], valueType: "integer", tone: "primary", note: "本月汇总" })}
      ${kpiCard({ label: "预计节约广告花费", value: invalidSpend + inefficientSpend, valueType: "currency", tone: "orange", note: "若关停当前无效和低效广告" })}
    </div>
    ${filterMarkup("invalid_low_efficiency", configs, null, `${invalidRows.length + inefficientRows.length} 条活动`)}
    <section class="dashboard-section" id="invalid-analysis">
      ${sectionHead("无效广告分析", "7月有花费无销售额的广告活动", `${invalidRows.length} 条`)}
      <div class="chart-grid">
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>无效花费 Top 品类</h4></div></div>
          ${horizontalBarChart(categoryInvalid.slice(0, 12).map((row) => ({ label: row.父标签, value: row.总花费 })), { formatter: (v) => formatCurrency(v, true) })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>无效活动数量 Top 品类</h4></div></div>
          ${horizontalBarChart([...categoryInvalid].sort((a, b) => b.广告活动数量 - a.广告活动数量).slice(0, 12).map((row) => ({ label: row.父标签, value: row.广告活动数量 })), { formatter: (v) => formatNumber(v, 0) })}
        </div>
      </div>
    </section>
    <section class="dashboard-section" id="inefficient-analysis">
      ${sectionHead("低效广告分析", "7月有订单且ACoS偏高的广告活动", `${inefficientRows.length} 条`)}
      <div class="chart-grid">
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>低效花费 Top 品类</h4></div></div>
          ${horizontalBarChart(categoryInefficient.slice(0, 12).map((row) => ({ label: row.父标签, value: row.总花费 })), { formatter: (v) => formatCurrency(v, true) })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>低效品类 ACoS</h4></div></div>
          ${horizontalBarChart([...categoryInefficient].sort((a, b) => b.平均ACoS - a.平均ACoS).slice(0, 12).map((row) => ({ label: row.父标签, value: row.平均ACoS })), { formatter: (v) => formatPercent(v) })}
        </div>
      </div>
    </section>
    <section class="dashboard-section" id="saving-analysis">
      ${sectionHead("节约花费视角", "6月已关停广告活动的理论已节约花费", `${filteredSavingsCategory.length} 个品类`)}
      <div class="chart-grid">
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>节约花费 Top 品类</h4></div></div>
          ${horizontalBarChart([...filteredSavingsCategory].sort((a, b) => b.节约广告花费 - a.节约广告花费).slice(0, 12).map((row) => ({ label: row.父标签 || "未匹配品类", value: row.节约广告花费 })), { formatter: (v) => formatCurrency(v, true) })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>节约花费按运营组长</h4></div></div>
          ${horizontalBarChart([...filteredSavingsOwner].sort((a, b) => b.节约广告花费 - a.节约广告花费).map((row) => ({ label: row.运营组长 || "未匹配负责人", value: row.节约广告花费 })), { formatter: (v) => formatCurrency(v, true) })}
        </div>
      </div>
    </section>
    <section class="dashboard-section" id="invalid-detail">
      <div class="invalid-detail-toolbar">
        <div class="invalid-detail-toolbar__main">
          ${sectionHead("广告活动明细", "无效与低效结果分页展示，便于定位广告活动。", `${detailRows.length} 条`)}
          ${invalidDetailFilterMarkup()}
        </div>
        <div class="invalid-detail-download">
          <div>
            <strong>下载筛选结果</strong>
            <span>导出当前筛选命中的全部 ${formatNumber(detailRows.length, 0)} 条明细，不受分页限制。</span>
          </div>
          <button type="button" class="button button--download" data-invalid-detail-download ${detailRows.length ? "" : "disabled"}>下载表格</button>
        </div>
      </div>
      <div class="chart-title-row">
        <div></div>
        ${segmentControl("invalid-detail", [["all", "全部"], ["invalid", "无效"], ["inefficient", "低效"]], state.ui.invalidDetailTab)}
      </div>
      ${tableMarkup("invalid-detail-table", detailRows, detailColumns, 50)}
    </section>
    <section class="dashboard-section" id="small-brand-contraction" hidden>
      ${sectionHead("小品牌广告收缩方案", "建立长期、自动化的小品牌广告监控与分批关停机制。", "方案说明")}
      <div class="strategy-brief">
        <div class="strategy-brief__section">
          <h3>一、项目背景</h3>
          <p>鉴于部分小品牌品类广告投产表现不佳，且其广告活动与主力品牌混投严重，人工逐一识别并关停的效率低下、可操作性差。结合公司未来将逐步削减小品牌广告预算的战略方向，亟需建立一套长效、自动化的监控与关停机制。</p>
        </div>
        <div class="strategy-brief__section">
          <h3>二、解决方案与执行路径</h3>
          <p>为系统性地推进此项工作，我们将从工具开发、数据监控和运营规则三个维度同步发力，具体如下：</p>
          <ol class="strategy-steps">
            <li><strong>工具端赋能（系统开发）</strong><p>已协同领星系统提出功能需求，计划新增“ASIN标签化管理”及“批量管控”模块。该功能上线后，支持按品牌维度一键筛选与批量关停广告活动，从根本上解决人工操作难题。目前需求已正式提交，正在等待对方确认开发排期。</p></li>
            <li><strong>数据端监控（临时过渡方案）</strong><p>在系统功能上线前，以周为周期，调取数据库内在投的小品牌ASIN数据，进行人工复核与监控管理，并同步更新至内部管理看板，确保数据的实时性与可追溯性，为决策提供及时、准确的依据。</p></li>
            <li><strong>运营端规则（长效约束机制）</strong><p>明确运营规范，即日起原则上不再为任何小品牌ASIN新增广告投放。同时，由中台牵头，统一定义各品类下的“小品牌”范畴，核心标准为：除PT、KAX两大品牌外，其余品牌均视为小品牌。当前纳入管控的小品牌包括：autosity、prolenz、suride、marsflux、zoncar、torchtree。以此为依据，制定分阶段、分批次的逐步关停计划，确保执行过程有序、可控。</p></li>
          </ol>
        </div>
      </div>
    </section>`;
}

function lingxingFilterConfig(data) {
  const filters = data.summary.filters;
  const previousMonth = data.summary.meta?.previous_month || "5月";
  const currentMonth = data.summary.meta?.current_month || "6月";
  const ownerCategoryMap = categoryOwnerMap(data.summary.trigger_monitor.detail || [], "品类", "运营组长");
  return [
    { id: "month", label: "月份", options: filters.月份 || [previousMonth, currentMonth] },
    { id: "owner", label: "运营组长", options: filters.运营组长 || [] },
    { id: "category", label: "品类", options: filters.品类 || [], linkedTo: "owner", ownerCategoryMap },
    { id: "rule", label: "规则类别", options: filters.规则类别 || [] },
    { id: "ruleGroup", label: "规则大类", options: filters.规则大类 || [] },
  ];
}

function filteredTriggerRows(data) {
  return (data.summary.trigger_monitor.detail || []).filter((row) => rowMatches("lingxing_rules", row, {
    category: "品类",
    owner: "运营组长",
    rule: "规则类别",
    ruleGroup: "规则大类",
  }));
}

function specialRuleFilterConfig(data) {
  const filters = data.summary.special_filters || {};
  const previousMonth = data.summary.meta?.previous_month || "5月";
  const currentMonth = data.summary.meta?.current_month || "6月";
  const ownerCategoryMap = categoryOwnerMap(data.summary.special_monitor?.detail || [], "品类", "运营组长");
  return [
    { id: "month", label: "月份", options: filters.月份 || [previousMonth, currentMonth] },
    { id: "owner", label: "运营组长", options: filters.运营组长 || [] },
    { id: "category", label: "品类", options: filters.品类 || [], linkedTo: "owner", ownerCategoryMap },
    { id: "rule", label: "规则类别", options: filters.规则类别 || [] },
    { id: "ruleGroup", label: "规则大类", options: filters.规则大类 || [] },
  ];
}

function filteredSpecialRows(data) {
  return (data.summary.special_monitor?.detail || []).filter((row) => rowMatches("lingxing_special", row, {
    category: "品类",
    owner: "运营组长",
    rule: "规则类别",
    ruleGroup: "规则大类",
  }));
}

function filteredSpecialActionRows(data) {
  return (data.action_detail.special_rows || []).filter((row) => rowMatches("lingxing_special", row, {
    category: "品类",
    owner: "运营组长",
    rule: "规则类别",
    ruleGroup: "规则大类",
  }));
}

function ruleQueryFilterConfig(data) {
  const ruleQuery = data.rule_query || { rows: [], filters: {} };
  const filters = ruleQuery.filters || {};
  const ownerCategoryMap = categoryOwnerMap(ruleQuery.rows || [], "品类", "运营组长");
  return [
    { id: "owner", label: "运营组长", options: filters.运营组长 || [] },
    { id: "category", label: "品类", options: filters.品类 || [], linkedTo: "owner", ownerCategoryMap },
    { id: "adType", label: "广告类型", options: filters.广告类型 || [] },
    { id: "ruleCategory", label: "规则组类别", options: filters.规则组类别 || [] },
  ];
}

function filteredRuleQueryRows(data) {
  return (data.rule_query?.rows || []).filter((row) => rowMatches("lingxing_rule_query", row, {
    owner: "运营组长",
    category: "品类",
    adType: "广告类型",
    ruleCategory: "规则组类别",
  })).sort((a, b) => String(a.品类).localeCompare(String(b.品类), "zh-CN")
    || String(a.广告类型).localeCompare(String(b.广告类型), "zh-CN")
    || String(a.规则组类别).localeCompare(String(b.规则组类别), "zh-CN"));
}

function renderLingxing() {
  const data = state.data.lingxing_rules;
  const previousMonth = data.summary.meta?.previous_month || "5月";
  const currentMonth = data.summary.meta?.current_month || "6月";
  const configs = lingxingFilterConfig(data);
  initializeFilters("lingxing_rules", configs);
  const specialConfigs = specialRuleFilterConfig(data);
  initializeFilters("lingxing_special", specialConfigs);
  const ruleQueryConfigs = ruleQueryFilterConfig(data);
  initializeFilters("lingxing_rule_query", ruleQueryConfigs);
  const detailFilter = initializeDetailFilter("lingxing_rules_detail", ["关键词/PAT暂停", "产品(ASIN)暂停", "否词"]);
  const triggerRows = filteredTriggerRows(data);
  const monthSet = selectedSet("lingxing_rules", "month");
  const previousVisible = monthSet.has(previousMonth);
  const currentVisible = monthSet.has(currentMonth);
  const ruleTotal = {
    previous: sum(triggerRows, "上周期触发次数"),
    current: sum(triggerRows, "本周期触发次数"),
  };
  const controlRows = triggerRows.filter((row) => row.规则大类 === "控费类");
  const investRows = triggerRows.filter((row) => row.规则大类 === "增投类");
  const negativeRows = triggerRows.filter((row) => row.规则类别 === "否词");
  const pauseRows = triggerRows.filter((row) => ["产品(ASIN)暂停", "关键词/PAT暂停"].includes(row.规则类别));

  const categoryRows = aggregateBy(triggerRows, "品类", {
    previous: (row) => row.上周期触发次数,
    current: (row) => row.本周期触发次数,
  }).sort((a, b) => b.current - a.current);
  const ruleRows = aggregateBy(triggerRows, "规则类别", {
    previous: (row) => row.上周期触发次数,
    current: (row) => row.本周期触发次数,
  }).sort((a, b) => b.current - a.current);
  const ownerRows = aggregateBy(triggerRows, "运营组长", {
    previous: (row) => row.上周期触发次数,
    current: (row) => row.本周期触发次数,
  }).sort((a, b) => b.current - a.current);
  const alerts = triggerRows.filter((row) => asNumber(row.上周期触发次数) > 0
      && ["触发偏低", "异常升高", "异常降低", "无触发"].includes(row.状态))
    .sort((a, b) => Math.abs(asNumber(b.增长偏离基准)) - Math.abs(asNumber(a.增长偏离基准)));

  const specialRows = filteredSpecialRows(data);
  const specialActionRows = filteredSpecialActionRows(data).sort((a, b) => String(b.触发日期).localeCompare(String(a.触发日期)));
  const specialMonthSet = selectedSet("lingxing_special", "month");
  const specialPreviousVisible = specialMonthSet.has(previousMonth);
  const specialCurrentVisible = specialMonthSet.has(currentMonth);

  const detailRows = (data.action_detail.rows || []).filter((row) => {
    const month = /^\d{4}-\d{2}$/.test(String(row.月份))
      ? `${Number(String(row.月份).slice(5, 7))}月`
      : row.月份;
    const mapped = { ...row, 筛选月份: month };
    return rowMatches("lingxing_rules", mapped, {
      month: "筛选月份",
      category: "品类",
      owner: "运营组长",
      rule: "规则类别",
      ruleGroup: "规则大类",
    }) && detailFilter.ruleApplied.size > 0
      && detailFilter.ruleApplied.has(row.规则类别)
      && detailSearchMatches("lingxing_rules_detail", row, ["广告活动", "标签"]);
  }).sort((a, b) => String(b.触发日期).localeCompare(String(a.触发日期)));

  const detailSummary = {
    campaigns: new Set(detailRows.map((row) => row.广告活动).filter(Boolean)).size,
    spend: sum(detailRows, "花费"),
    orders: sum(detailRows, "订单"),
    sales: sum(detailRows, "销售额"),
  };

  const detailColumns = [
    { field: "月份", label: "月份" },
    { field: "触发日期", label: "触发日期" },
    { field: "店铺", label: "店铺" },
    { field: "品类", label: "品类" },
    { field: "运营组长", label: "运营组长" },
    { field: "规则类别", label: "规则类别", render: (v) => tagMarkup(v) },
    { field: "规则大类", label: "规则大类" },
    { field: "原始规则名", label: "原始规则名", long: true },
    { field: "广告活动", label: "广告活动", long: true },
    { field: "标签", label: "标签", long: true },
    { field: "优化对象", label: "优化对象" },
    { field: "对象明细", label: "对象明细", long: true },
    { field: "命中取值", label: "命中取值", long: true },
  ];
  const ruleQueryRows = filteredRuleQueryRows(data);
  const ruleQueryColumns = [
    { field: "品类", label: "品类" },
    { field: "广告类型", label: "广告类型" },
    { field: "运营组长", label: "运营组长" },
    { field: "广告组负责人", label: "广告组负责人" },
    { field: "规则", label: "规则", long: true },
    { field: "规则组类别", label: "规则组类别" },
    { field: "针对标签", label: "针对标签（默认全部）", long: true, render: (v) => v ? escapeHtml(v) : "默认全部" },
    { field: "覆盖周期", label: "覆盖周期" },
    { field: "通知邮箱", label: "通知邮箱", long: true },
  ];

  const kpiRows = [
    { label: "规则触发总数", rows: triggerRows, tone: "primary" },
    { label: "控费类触发数", rows: controlRows, tone: "teal" },
    { label: "增投类触发数", rows: investRows, tone: "orange" },
    { label: "否词触发数", rows: negativeRows, tone: "primary" },
    { label: "关键词/产品暂停触发数", rows: pauseRows, tone: "green" },
  ];
  const kpis = kpiRows.map((item) => kpiCard({
    label: item.label,
    value: currentVisible ? sum(item.rows, "本周期触发次数") : sum(item.rows, "上周期触发次数"),
    previous: previousVisible && currentVisible ? sum(item.rows, "上周期触发次数") : null,
    valueType: "integer",
    tone: item.tone,
    note: currentVisible ? currentMonth : previousMonth,
  })).join("");

  root.innerHTML = `
    ${introMarkup("领星规则复盘", "监控规则触发变化、专项规则动作和异常品类。", `${previousMonth} vs ${currentMonth}`, "主规则触发监控已排除来货自动重开和低库存产品暂停；两类动作在专项规则视图单独查看。")}
    <div class="kpi-grid kpi-grid--five">${kpis}</div>
    ${filterMarkup("lingxing_rules", configs, null, `${triggerRows.length} 个监控组合`)}
    <section class="dashboard-section" id="trigger-monitor">
      ${sectionHead("规则触发监控", "对比同品类、同规则与整体变化基准，关注触发次数明显偏离的规则。", `${alerts.length} 个待关注组合`)}
      <div class="chart-grid">
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>触发次数 Top 品类</h4></div>${legendMarkup(previousMonth, currentMonth)}</div>
          ${verticalCompareChart(categoryRows.slice(0, 14).map((row) => ({ label: row.品类, previous: row.previous, current: row.current })), { previousVisible, currentVisible, formatter: (v) => formatCompact(v) })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>规则类别触发对比</h4></div>${legendMarkup(previousMonth, currentMonth)}</div>
          ${compareList(ruleRows.slice(0, 12).map((row) => ({ label: row.规则类别, previous: row.previous, current: row.current, formatter: (v) => formatNumber(v, 0) })), { previousVisible, currentVisible, wrapLabels: true })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>运营组长触发对比</h4></div>${legendMarkup(previousMonth, currentMonth)}</div>
          ${verticalCompareChart(ownerRows.map((row) => ({ label: row.运营组长, previous: row.previous, current: row.current })), { previousVisible, currentVisible, formatter: (v) => formatCompact(v) })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>触发次数变化较大的规则</h4><p>不包含上周期未触发、本周期新增触发的规则</p></div></div>
          <div class="alert-list">
            ${alerts.length ? alerts.slice(0, 10).map((row) => `
              <div class="alert-item">
                ${tagMarkup("触发次数变化较大")}
                <div><strong>${escapeHtml(row.品类)} · ${escapeHtml(row.规则类别)}</strong><p>${escapeHtml(triggerReason(row))}</p></div>
                <span>${formatNumber(row.上周期触发次数, 0)} → ${formatNumber(row.本周期触发次数, 0)}</span>
              </div>`).join("") : emptyState()}
          </div>
        </div>
      </div>
    </section>
    <section class="dashboard-section" id="special-monitor">
      ${sectionHead("专项规则视图", "来货自动重开和低库存产品暂停单独统计，只展示规则触发次数与动作明细，不计算理论节费。", `${specialRows.length} 个监控组合`)}
      ${filterMarkup("lingxing_special", specialConfigs, null, `${specialRows.length} 个监控组合`)}
      <div class="chart-grid">
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>专项规则类别对比</h4></div>${legendMarkup(previousMonth, currentMonth)}</div>
          ${compareList(aggregateBy(specialRows, "规则类别", {
            previous: (row) => row.上周期触发次数,
            current: (row) => row.本周期触发次数,
          }).map((row) => ({ label: row.规则类别, previous: row.previous, current: row.current, formatter: (v) => formatNumber(v, 0) })), { previousVisible: specialPreviousVisible, currentVisible: specialCurrentVisible, wrapLabels: true })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>专项规则 Top 品类</h4></div>${legendMarkup(previousMonth, currentMonth)}</div>
          ${verticalCompareChart(aggregateBy(specialRows, "品类", {
            previous: (row) => row.上周期触发次数,
            current: (row) => row.本周期触发次数,
          }).sort((a, b) => b.current - a.current).slice(0, 14).map((row) => ({ label: row.品类, previous: row.previous, current: row.current })), { previousVisible: specialPreviousVisible, currentVisible: specialCurrentVisible, formatter: (v) => formatCompact(v) })}
        </div>
      </div>
      <div class="chart-panel chart-panel--full">
          <div class="chart-title-row"><div><h4>专项规则动作明细</h4><p>来货自动重开包含来货自动打开、来货自动重开、来货重开及其他暂停→启用记录</p></div></div>
          ${tableMarkup("lingxing-special-table", specialActionRows, [
            { field: "月份", label: "月份" },
            { field: "触发日期", label: "触发日期" },
            { field: "店铺", label: "店铺" },
            { field: "品类", label: "品类" },
            { field: "运营组长", label: "运营组长" },
            { field: "规则类别", label: "规则类别", render: (v) => tagMarkup(v) },
            { field: "原始规则名", label: "原始规则名" },
            { field: "广告活动", label: "广告活动", long: true },
            { field: "对象明细", label: "对象明细", long: true },
            { field: "优化前状态", label: "优化前" },
            { field: "优化后状态", label: "优化后" },
            { field: "优化动作", label: "执行动作" },
          ], 10)}
      </div>
    </section>
    <section class="dashboard-section" id="saving-detail">
      ${sectionHead("节费规则触发明细", "保留产品(ASIN)暂停、关键词/PAT暂停和否词触发记录；不含来货自动重开，不计算理论节费。", `${detailRows.length} 条`)}
      ${detailFilterMarkup("lingxing_rules_detail", {
        options: ["关键词/PAT暂停", "产品(ASIN)暂停", "否词"],
        searchLabel: "节费明细关键词",
        placeholder: "搜索广告活动名称或标签关键词",
      })}
      <div class="detail-summary-grid">
        ${detailMetricCard("广告活动数量", detailSummary.campaigns, "integer", "广告活动去重计数")}
        ${detailMetricCard("花费", detailSummary.spend, "currency")}
        ${detailMetricCard("订单", detailSummary.orders, "integer")}
        ${detailMetricCard("销售额", detailSummary.sales, "currency")}
      </div>
      ${tableMarkup("lingxing-detail-table", detailRows, detailColumns, 7)}
      <div class="method-note">花费、订单与销售额为当前筛选触发记录的取数窗口字段汇总，不等同整月广告表现。来货自动重开和低库存产品暂停已移至专项规则视图。</div>
    </section>
    `;
}

function batchFilterConfig(data) {
  const ownerCategoryMap = categoryOwnerMap(data.summary_cross || [], "品类", "品类负责人");
  const categoryOptions = unique([
    ...(data.filters.品类 || []),
    ...(data.operation_filters?.品类 || []),
  ]);
  const configs = [
    { id: "month", label: "月份", options: (data.filters.月份 || []).map(String) },
    { id: "owner", label: "运营组长", options: data.filters.品类负责人 || [] },
    { id: "category", label: "品类", options: categoryOptions, linkedTo: "owner", ownerCategoryMap },
  ];
  if ((data.filters.团队 || []).length) {
    configs.push({ id: "team", label: "团队", options: data.filters.团队 });
  }
  return configs;
}

function batchOperationFilterConfig(data) {
  const rows = data.operation_batch_rows || [];
  const filters = data.operation_filters || {};
  return [
    { id: "month", label: "月份", options: (filters.月份 || unique(rows.map((row) => row.月份))).map(String) },
    { id: "owner", label: "运营组长", options: filters.运营组长 || unique(rows.map((row) => row.运营组长)) },
    { id: "category", label: "品类", options: filters.品类 || unique(rows.flatMap((row) => splitMultiValue(row.品类名称))) },
    { id: "operator", label: "运营", options: filters.运营 || unique(rows.map((row) => row.运营)) },
  ];
}

function operationRowMatches(row, filters) {
  const monthSet = selectedSet("batch_operation_detail", "month");
  const ownerSet = selectedSet("batch_operation_detail", "owner");
  const categorySet = selectedSet("batch_operation_detail", "category");
  const operatorSet = selectedSet("batch_operation_detail", "operator");
  const minDays = state.batchOperationDays.minApplied;
  const maxDays = state.batchOperationDays.maxApplied;
  const onlineDays = Number(row.上线天数);
  const matchesMulti = (value, selected) => selected.size > 0 && splitMultiValue(value).some((item) => selected.has(item));
  return monthSet.has(String(row.月份))
    && (minDays === null || onlineDays > minDays)
    && (maxDays === null || onlineDays < maxDays)
    && ownerSet.has(row.运营组长)
    && matchesMulti(row.品类名称, categorySet)
    && operatorSet.has(row.运营);
}

function batchAggregate(rows) {
  const batchCount = sum(rows, "批量活动数量");
  const allCount = sum(rows, "全部活动数量");
  const spend = sum(rows, "批量广告花费");
  const sales = sum(rows, "批量销售额");
  const totalSpend = sum(rows, "品类总花费");
  const totalSales = sum(rows, "品类总销售额");
  return {
    batchCount,
    allCount,
    coverage: safeDivide(batchCount, allCount),
    spend,
    sales,
    totalSpend,
    totalSales,
    spendShare: totalSpend > 0 ? spend / totalSpend : null,
    acos: spend > 0 && sales > 0 ? spend / sales : null,
    categoryAcos: totalSpend > 0 && totalSales > 0 ? totalSpend / totalSales : null,
    salesContribution: totalSales > 0 ? sales / totalSales : null,
  };
}

function batchSummaryRowsToRaw(rows) {
  return rows.map((row) => {
    const batchSpend = asNumber(row.批量广告花费);
    const batchAcos = asNumber(row.批量ACOS);
    const categoryAcos = asNumber(row.品类平均ACOS);
    const salesContribution = asNumber(row.批量销售贡献率);
    const spendContribution = asNumber(row.批量活动花费占比);
    const batchSales = batchSpend > 0 && batchAcos > 0 ? batchSpend / batchAcos : 0;
    const totalSales = batchSales > 0 && salesContribution > 0 ? batchSales / salesContribution : 0;
    return {
      ...row,
      批量销售额: batchSales,
      品类总花费: batchSpend > 0 && spendContribution > 0
        ? batchSpend / spendContribution
        : totalSales > 0 && categoryAcos > 0 ? totalSales * categoryAcos : 0,
      品类总销售额: totalSales,
    };
  });
}

function formatBatchMonthLabel(value) {
  const month = String(value);
  return /^\d{6}$/.test(month)
    ? `${month.slice(0, 4)}-${month.slice(4, 6)}`
    : month;
}

function batchRowsByDimension(rows, dimensionField, options = {}) {
  const grouped = new Map();
  rows.forEach((row) => {
    const dimension = row[dimensionField] || "未匹配";
    const key = options.combineMonths ? dimension : `${row.月份}::${dimension}`;
    if (!grouped.has(key)) grouped.set(key, { 月份: options.periodLabel || row.月份, 维度: dimension });
    const target = grouped.get(key);
    ["批量活动数量", "全部活动数量", "批量广告花费", "批量销售额", "品类总花费", "品类总销售额"].forEach((field) => {
      target[field] = asNumber(target[field]) + asNumber(row[field]);
    });
  });
  return [...grouped.values()].map((row) => {
    const aggregate = batchAggregate([row]);
    return {
      ...row,
      活动覆盖率: aggregate.coverage,
      批量活动花费占比: aggregate.spendShare,
      批量ACOS: aggregate.acos,
      品类平均ACOS: aggregate.categoryAcos,
      ACOS差异: aggregate.acos !== null && aggregate.categoryAcos !== null ? aggregate.acos - aggregate.categoryAcos : null,
      批量销售贡献率: aggregate.salesContribution,
    };
  });
}

function renderBatch() {
  const data = state.data.batch_launch;
  const configs = batchFilterConfig(data);
  const operationConfigs = batchOperationFilterConfig(data);
  initializeFilters("batch_launch", configs);
  initializeFilters("batch_operation_detail", operationConfigs);
  const monthSet = selectedSet("batch_launch", "month");
  const categorySet = selectedSet("batch_launch", "category");
  const teamConfig = configs.find((config) => config.id === "team");
  const teamSet = teamConfig ? selectedSet("batch_launch", "team") : null;
  const ownerSet = selectedSet("batch_launch", "owner");
  const selectedMonths = [...monthSet].sort((a, b) => Number(a) - Number(b));
  const periodLabel = selectedMonths.join("+");
  const categoryAllSelected = isAllSelected("batch_launch", configs.find((config) => config.id === "category"));
  const crossRows = (data.summary_cross || []).filter((row) => monthSet.has(String(row.月份))
    && (categoryAllSelected || categorySet.has(row.品类))
    && (!teamSet || teamSet.has(row.团队))
    && ownerSet.has(row.品类负责人));
  const activityCrossRows = (data.activity_summary_cross || data.summary_cross || []).filter((row) => monthSet.has(String(row.月份))
    && (categoryAllSelected || categorySet.has(row.品类))
    && (!teamSet || teamSet.has(row.团队))
    && ownerSet.has(row.品类负责人));
  const monthlyCategoryRows = batchRowsByDimension(crossRows, "品类");
  const eligibleCategoryMonths = new Set(monthlyCategoryRows
    .filter((row) => row.批量广告花费 > 0)
    .map((row) => `${row.月份}::${row.维度}`));
  const eligibleCrossRows = crossRows.filter((row) => eligibleCategoryMonths.has(`${row.月份}::${row.品类}`));
  const categoryRows = batchRowsByDimension(eligibleCrossRows, "品类", { combineMonths: true, periodLabel });
  const teamRows = batchRowsByDimension(
    batchSummaryRowsToRaw((data.summary_by_team || []).filter((row) => monthSet.has(String(row.月份)))),
    "维度",
    { combineMonths: true, periodLabel },
  ).filter((row) => row.批量广告花费 > 0);
  const ownerRows = batchRowsByDimension(eligibleCrossRows, "品类负责人", { combineMonths: true, periodLabel }).filter((row) => row.批量广告花费 > 0);
  const latestMonth = selectedMonths.at(-1);
  const previousMonth = selectedMonths.length > 1 ? selectedMonths.at(-2) : null;
  const currentRows = monthlyCategoryRows.filter((row) => String(row.月份) === latestMonth && row.批量广告花费 > 0);
  const currentFinancial = batchAggregate(crossRows.filter((row) => String(row.月份) === latestMonth));
  const currentActivity = batchAggregate(activityCrossRows.filter((row) => String(row.月份) === latestMonth));
  const current = { ...currentFinancial, batchCount: currentActivity.batchCount, allCount: currentActivity.allCount, coverage: currentActivity.coverage };
  const previousFinancial = previousMonth ? batchAggregate(crossRows.filter((row) => String(row.月份) === previousMonth)) : null;
  const previousActivity = previousMonth ? batchAggregate(activityCrossRows.filter((row) => String(row.月份) === previousMonth)) : null;
  const previous = previousFinancial && previousActivity
    ? { ...previousFinancial, batchCount: previousActivity.batchCount, allCount: previousActivity.allCount, coverage: previousActivity.coverage }
    : previousFinancial;
  const coverageRows = batchRowsByDimension(activityCrossRows, "品类", { combineMonths: true, periodLabel })
    .filter((row) => row.全部活动数量 > 0)
    .sort((a, b) => b.活动覆盖率 - a.活动覆盖率);
  const coverageMax = niceFractionMax(coverageRows.map((row) => row.活动覆盖率));
  const lowEfficiencyRows = currentRows
    .map((row) => {
      const acosGap = asNumber(row.批量ACOS) - asNumber(row.品类平均ACOS);
      const contributionGap = asNumber(row.批量活动花费占比) - asNumber(row.批量销售贡献率);
      const severity = acosGap >= 0.08 ? "严重异常" : "异常";
      return {
        ...row,
        异常级别: severity,
        投入产出差异: contributionGap,
        低效ACOS差异: acosGap,
        处理建议: severity === "严重异常"
          ? "停止扩大投放；重点优化高花费低转化活动，必要时关闭批量投放并单独排查。"
          : "暂停扩大投放；优化现有活动的关键词、竞价和低转化目标，复查后再恢复扩量。",
      };
    })
    .filter((row) => row.批量广告花费 >= 100
      && row.低效ACOS差异 >= 0.05
      && row.投入产出差异 > 0)
    .sort((a, b) => b.低效ACOS差异 - a.低效ACOS差异);
  const lowEfficiencyColumns = [
    { field: "异常级别", label: "异常级别", render: (v) => tagMarkup(v) },
    { field: "维度", label: "品类" },
    { field: "批量广告花费", label: "批量花费", numeric: true, render: (v) => formatCurrency(v) },
    { field: "批量活动花费占比", label: "花费占比", numeric: true, render: (v) => formatPercent(v, true) },
    { field: "批量销售贡献率", label: "销售贡献率", numeric: true, render: (v) => formatPercent(v, true) },
    { field: "投入产出差异", label: "花费占比 - 销售贡献率", numeric: true, render: (v) => formatSignedFractionPercent(v) },
    { field: "批量ACOS", label: "批量 ACoS", numeric: true, render: (v) => formatPercent(v, true) },
    { field: "品类平均ACOS", label: "品类平均 ACoS", numeric: true, render: (v) => formatPercent(v, true) },
    { field: "低效ACOS差异", label: "批量 - 品类平均", numeric: true, render: (v) => formatSignedFractionPercent(v) },
    { field: "处理建议", label: "处理建议", wrap: true },
  ];

  const monthScale = selectedMonths.map((month) => {
    const aggregate = batchAggregate(activityCrossRows.filter((row) => String(row.月份) === month));
    const monthText = String(month);
    const label = /^\d{6}$/.test(monthText) ? `${Number(monthText.slice(4, 6))}月` : monthText;
    return { label, value: aggregate.batchCount };
  });

  const operationRows = (data.operation_batch_rows || [])
    .map((row) => ({
      ...row,
      上线天数: batchOnlineDays(row.运营批次号),
    }))
    .filter((row) => operationRowMatches(row, operationConfigs))
    .sort((a, b) => String(b.月份).localeCompare(String(a.月份))
      || String(a.运营).localeCompare(String(b.运营), "zh-CN")
      || String(a.运营批次号).localeCompare(String(b.运营批次号), "zh-CN"));
  const operationColumns = [
    { field: "月份", label: "月份", render: (v) => escapeHtml(formatBatchMonthLabel(v)) },
    { field: "运营批次号", label: "批次号" },
    { field: "上线天数", label: "上线天数", numeric: true, render: (v) => v === null ? "-" : `${formatNumber(v, 0)}天` },
    { field: "运营组长", label: "运营组长" },
    { field: "运营", label: "运营" },
    { field: "品类名称", label: "品类" },
    { field: "活动数量", label: "活动数量", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "广告花费", label: "广告花费", numeric: true, render: (v) => v === null ? "-" : formatCurrency(v) },
    { field: "广告销售额", label: "广告销售额", numeric: true, render: (v) => v === null ? "-" : formatCurrency(v) },
    { field: "广告订单", label: "广告订单", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "平均CPC", label: "平均 CPC", numeric: true, render: (v) => v === null ? "-" : formatCurrency(v) },
    { field: "ACOS", label: "ACoS", numeric: true, render: (v) => v === null ? "-" : formatPercent(v, true) },
  ];

  let summaryRows = categoryRows;
  let summaryColumns = [
    { field: "月份", label: "所选月份", render: (v) => String(v).split("+").map(formatBatchMonthLabel).join(" + ") },
    { field: "维度", label: "品类" },
    { field: "批量活动数量", label: "批量活动数量", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "全部活动数量", label: "全部活动数量", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "活动覆盖率", label: "活动覆盖率", numeric: true, render: (v) => formatPercent(v, true) },
    { field: "批量广告花费", label: "批量广告花费", numeric: true, render: (v) => formatCurrency(v) },
    { field: "批量活动花费占比", label: "批量活动花费占比", numeric: true, render: (v) => v === null ? "-" : formatPercent(v, true) },
    { field: "批量ACOS", label: "批量 ACoS", numeric: true, render: (v) => v === null || asNumber(v) <= 0 ? "-" : formatPercent(v, true) },
    { field: "品类平均ACOS", label: "品类平均 ACoS", numeric: true, render: (v) => v === null || asNumber(v) <= 0 ? "-" : formatPercent(v, true) },
    { field: "ACOS差异", label: "批量 ACoS - 品类平均", numeric: true, render: (v) => {
      if (v === null || v === undefined) return "-";
      const difference = asNumber(v);
      const tone = difference > 0 ? "is-bad" : difference < 0 ? "is-good" : "is-neutral";
      return `<span class="acos-difference ${tone}">${formatSignedFractionPercent(difference)}</span>`;
    } },
    { field: "批量销售贡献率", label: "批量销售贡献率", numeric: true, render: (v) => v === null ? "-" : formatPercent(v, true) },
  ];
  if (state.ui.batchSummaryTab === "team") {
    summaryRows = teamRows;
    summaryColumns = summaryColumns.map((column) => column.field === "维度" ? { ...column, label: "团队" } : column);
  }
  if (state.ui.batchSummaryTab === "owner") {
    summaryRows = ownerRows;
    summaryColumns = summaryColumns.map((column) => column.field === "维度" ? { ...column, label: "运营组长" } : column);
  }
  summaryRows = [...summaryRows].sort((a, b) => b.批量活动数量 - a.批量活动数量);

  root.innerHTML = `
    ${introMarkup("批量投放系统运营看板", "查看批量活动创建规模、活动覆盖率及批量 ACoS 与品类平均的差异。", "2026年6月 vs 7月")}
    <div class="kpi-grid">
      ${kpiCard({ label: "批量广告活动数量", value: current.batchCount, previous: previous?.batchCount, valueType: "integer", tone: "primary", note: latestMonth ? `${String(latestMonth).slice(0, 4)}年${String(latestMonth).slice(4)}月` : "当前筛选" })}
      ${kpiCard({ label: "活动覆盖率", value: current.coverage, previous: previous?.coverage, valueType: "fractionPercent", tone: "teal", note: "批量活动数 / 全部活动数" })}
      ${kpiCard({ label: "批量广告花费", value: current.spend, previous: previous?.spend, valueType: "currency", tone: "orange", inverse: true })}
      ${kpiCard({
        label: "批量活动花费占比",
        value: current.spendShare,
        previous: previous?.spendShare,
        valueType: "fractionPercent",
        tone: "teal",
        note: "批量广告花费 / 品类总花费",
        comparisonMarkup: previous
          ? `批量广告花费 / 品类总花费 ${fractionDeltaPercentOnly(current.spendShare, previous.spendShare)}`
          : "批量广告花费 / 品类总花费",
      })}
      ${kpiCard({ label: "批量 ACoS", value: current.acos, previous: previous?.acos, valueType: "fractionPercent", tone: "red", inverse: true })}
    </div>
    ${filterMarkup("batch_launch", configs, null, `${categoryRows.length} 个有批量花费的品类`)}
    <section class="dashboard-section" id="batch-scale">
      ${sectionHead("批量投放规模", "按月比较批量活动数量，不展示花费趋势。", selectedMonths.map(formatBatchMonthLabel).join(" vs "))}
      <div class="chart-panel chart-panel--full">
        ${horizontalBarChart(monthScale, { formatter: (v) => formatNumber(v, 0) })}
      </div>
    </section>
    <section class="dashboard-section" id="batch-coverage">
      ${sectionHead("活动覆盖率", "数量覆盖率 = 所选月份批量活动数量 / 全部活动数量；多月选择时合并计算。", `${coverageRows.length} 个品类`)}
      <div class="chart-panel chart-panel--full">
        ${verticalCompareChart(coverageRows.map((row) => ({ label: row.维度, previous: 0, current: row.活动覆盖率 })), { previousVisible: false, currentVisible: true, scaleMax: coverageMax, showYAxis: true, className: "vertical-chart--coverage", formatter: (v) => formatPercent(v, true), axisFormatter: (v) => formatPercent(v, true, 0) })}
      </div>
    </section>
    <section class="dashboard-section" id="batch-low-efficiency">
      ${sectionHead("低效批量广告", "识别投入产出失衡且批量 ACoS 明显高于品类平均的品类，并给出对应处理方式。", `${lowEfficiencyRows.length} 个待处理品类`)}
      <div class="batch-treatment-grid">
        <article class="batch-treatment-card is-danger">
          <div>${tagMarkup("严重异常")}</div>
          <h4>ACoS 差异 ≥ 8 个百分点</h4>
          <p>停止扩大投放；重点优化高花费、低转化活动。必要时关闭批量投放，并对品类进行单独排查。</p>
        </article>
        <article class="batch-treatment-card is-warning">
          <div>${tagMarkup("异常")}</div>
          <h4>ACoS 差异为 5–8 个百分点</h4>
          <p>暂停扩大投放；优化现有活动的关键词、竞价和低转化目标，复查效果后再恢复扩量。</p>
        </article>
      </div>
      <div class="method-note batch-low-efficiency-rule">进入清单需同时满足：当前月份批量花费 ≥ $100、批量 ACoS 高于品类平均至少 5 个百分点，且批量花费占比高于销售贡献率。差异口径统一为“批量 − 品类平均”。</div>
      ${tableMarkup("batch-low-efficiency-table", lowEfficiencyRows, lowEfficiencyColumns, 20)}
    </section>
    <section class="dashboard-section" id="batch-summary">
      ${sectionHead("批量投放汇总明细", "按所选月份合并汇总；无批量花费的品类不展示。", `${summaryRows.length} 条`)}
      <div class="chart-title-row">
        <div></div>
        ${segmentControl("batch-summary", [["category", "按品类"], ["team", "按团队"], ["owner", "按运营组长"]], state.ui.batchSummaryTab)}
      </div>
      ${tableMarkup("batch-summary-table", summaryRows, summaryColumns, 10)}
      <div class="method-note">${teamConfig ? "月份、运营组长、品类与团队均会联动更新顶部 KPI、投放规模、覆盖率、ACoS 对比和汇总明细。" : "月份、运营组长与品类会联动更新顶部 KPI、投放规模、覆盖率、ACoS 对比和汇总明细；团队页签按月度汇总表独立展示。"}</div>
    </section>
    <section class="dashboard-section" id="batch-operation-detail">
      ${sectionHead("批量投放批次查询", "批量投放批次查询表只提供批次整体数据，运营可以筛选自己名下的批次号，使用批次号到领星平台筛选活动，查看单条活动详情", `${operationRows.length} 条`)}
      ${batchOperationFilterMarkup(operationConfigs, `${operationRows.length} 条批次`)}
      ${tableMarkup("batch-operation-table", operationRows, operationColumns, 50)}
      <div class="method-note">本查询表使用独立筛选器，不受页面上方批量投放数据筛选影响；上线天数筛选仅作用于本表，不影响上方图表和汇总明细。</div>
    </section>
    <section class="dashboard-section" id="batch-demand-stats">
      ${sectionHead("上周需求统计", "内嵌钉钉需求统计仪表盘，用于查看批量投放需求收集与完成情况。", "钉钉在线看板")}
      <div class="embed-panel">
        <iframe
          class="dingtalk-embed"
          src="https://alidocs.dingtalk.com/notable/share/dashboard/128717d4c5c7fcffe422786e31991dc2_v9kqDejxQXkZ3OVx"
          title="上周需求统计"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
        ></iframe>
      </div>
    </section>`;
}

function renderSubnav() {
  const config = PAGE_CONFIG[state.page];
  let sections = config.sections;
  if (state.page === "weekly_review" && state.weeklyReport) {
    const report = ensureReportSelection().report;
    const groupBySection = {
      "report-attention": "attention",
      "report-required": "required",
    };
    if (report) sections = sections.filter(([id]) => !groupBySection[id] || reportFilteredCategories(report, groupBySection[id]).length > 0);
    if (report) sections = sections.filter(([id]) => id !== "report-batch-monitor" || Boolean(report.batch_monitor?.tables?.some((table) => table?.rows?.length)));
  }
  const sectionLinks = sections.map(([id, label], index) => {
    const sbsdRequestLink = state.page === "monthly_review" && id === "monthly-sbsd-share"
      ? `<a class="subnav-action" href="https://alidocs.dingtalk.com/notable/share/form/v01AJdl659bwZ8Q7Oke_GNZbE2w_i7B4JaT?source=link" target="_blank" rel="noopener noreferrer">SBSD投放需求</a>`
      : "";
    return `<a class="subnav-link ${index === 0 ? "is-active" : ""}" href="#${escapeHtml(id)}">${escapeHtml(label)}</a>
      ${sbsdRequestLink}`;
  }).join("");
  const batchApplicationLink = state.page === "batch_launch"
    ? `<a class="subnav-action" href="https://alidocs.dingtalk.com/notable/share/form/v01v9kqDejxQXkZ3OVx_tblZw1SF2hzdPvpj_vew40qPDRC?source=link" target="_blank" rel="noopener noreferrer">批量投放申请表</a>`
    : "";
  const lingxingRuleRequestLink = state.page === "lingxing_rules"
    ? `<a class="subnav-action" href="https://alidocs.dingtalk.com/i/nodes/YMyQA2dXW79wl46vhZMAP7aaJzlwrZgb?utm_scene=person_space&amp;iframeQuery=viewId%3D1qX0QQ0%26sheetId%3Ddv19yqvsgs3oebp3pcjys" target="_blank" rel="noopener noreferrer">新增/修改规则需求收集表</a>`
    : "";
  subnav.innerHTML = sectionLinks + batchApplicationLink + lingxingRuleRequestLink;
}

function updateDataStatusForCurrentPage() {
  if (state.page === "weekly_review") {
    if (!state.weeklyReport) {
      dataStatus.className = "data-status is-error";
      dataStatus.innerHTML = '<span class="status-dot"></span><span>月报数据未加载</span>';
      return;
    }
    dataStatus.className = "data-status is-ready";
    dataStatus.innerHTML = `<span class="status-dot"></span><span>${escapeHtml(weeklyGeneratedLabel(state.weeklyReport.meta?.generated_at))}</span>`;
    return;
  }
  const generatedCandidates = [state.data?.meta?.generated_at, state.weeklyReport?.meta?.generated_at]
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.valueOf()));
  const generated = generatedCandidates.sort((a, b) => b.valueOf() - a.valueOf())[0] || null;
  const freshness = generatedTimestampLabel(generated);
  dataStatus.className = "data-status is-ready";
  dataStatus.innerHTML = `<span class="status-dot"></span><span>${escapeHtml(freshness)}</span>`;
}

function renderCurrentPage() {
  pageTitle.textContent = PAGE_CONFIG[state.page].title;
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.page === state.page);
  });
  updateDataStatusForCurrentPage();
  renderSubnav();
  if (state.page === "monthly_review") renderMonthly();
  if (state.page === "weekly_review") renderWeekly();
  if (state.page === "invalid_low_efficiency") renderInvalid();
  if (state.page === "lingxing_rules") renderLingxing();
  if (state.page === "batch_launch") renderBatch();
  bindSectionObserver();
}

function renderCurrentPageAtSection(sectionId) {
  renderCurrentPage();
  const section = document.getElementById(sectionId);
  if (!section) return;
  section.scrollIntoView({ block: "start" });
  setActiveSubnav(sectionId);
}

function pageFilterConfigs(pageId) {
  if (pageId === "monthly_review") return monthlyFilterConfig(state.data.monthly_review);
  if (pageId === "invalid_low_efficiency") return invalidFilterConfig(state.data.invalid_low_efficiency);
  if (pageId === "lingxing_rules") return lingxingFilterConfig(state.data.lingxing_rules);
  if (pageId === "lingxing_special") return specialRuleFilterConfig(state.data.lingxing_rules);
  if (pageId === "lingxing_rule_query") return ruleQueryFilterConfig(state.data.lingxing_rules);
  if (pageId === "batch_launch") return batchFilterConfig(state.data.batch_launch);
  if (pageId === "batch_operation_detail") return batchOperationFilterConfig(state.data.batch_launch);
  return [];
}

function syncLinkedCategoryFilter(pageId, ownerFilterId) {
  const configs = pageFilterConfigs(pageId);
  const categoryConfig = configs.find((config) => config.linkedTo === ownerFilterId);
  if (!categoryConfig) return;
  const options = filterOptions(pageId, categoryConfig, true);
  const selected = new Set(options);
  state.filterDraft[pageId][categoryConfig.id] = selected;
  state.filterManual[pageId][categoryConfig.id] = false;

  const panel = [...document.querySelectorAll("[data-page-filter]")]
    .find((element) => element.dataset.pageFilter === pageId);
  const select = panel
    ? [...panel.querySelectorAll(".multi-select")].find((element) => element.dataset.filterId === categoryConfig.id)
    : null;
  if (!select) return;
  select.querySelector(".multi-select__button").textContent = selectedLabel(pageId, categoryConfig);
  const menu = select.querySelector(".multi-select__menu");
  if (menu) menu.innerHTML = multiSelectMenuMarkup(options, selected);
}

function updateMultiSelectButton(select) {
  const detailPanel = select.closest("[data-detail-filter]");
  if (detailPanel) {
    const detailState = state.detailFilters[detailPanel.dataset.detailFilter];
    select.querySelector(".multi-select__button").textContent = detailSelectedLabel(detailState);
    return;
  }
  const pageId = select.closest("[data-page-filter]").dataset.pageFilter;
  const filterId = select.dataset.filterId;
  const configs = pageFilterConfigs(pageId);
  const config = configs.find((item) => item.id === filterId);
  select.querySelector(".multi-select__button").textContent = selectedLabel(pageId, config);
}

function closeMultiSelects(except = null) {
  document.querySelectorAll(".multi-select.is-open").forEach((select) => {
    if (select === except) return;
    select.classList.remove("is-open");
    select.querySelector(".multi-select__menu")?.classList.add("is-hidden");
    select.querySelector(".multi-select__button")?.setAttribute("aria-expanded", "false");
  });
}

function filterMultiSelectOptions(input) {
  const select = input.closest(".multi-select");
  const labels = [...select.querySelectorAll(".check-option")];
  const query = input.value.trim();
  let visibleCount = 0;
  labels.forEach((label) => {
    const option = label.querySelector('input[type="checkbox"]')?.value || "";
    const isVisible = fuzzyOptionMatch(option, query);
    label.classList.toggle("is-option-hidden", !isVisible);
    // 默认全选时，搜索结果以未勾选状态展示；搜索本身不改变实际筛选结果。
    const pagePanel = select.closest("[data-page-filter]");
    const pageId = pagePanel?.dataset.pageFilter;
    const config = pageId && pageFilterConfigs(pageId).find((item) => item.id === select.dataset.filterId);
    const options = config ? filterOptions(pageId, config, true) : [];
    const selected = pageId ? state.filterDraft[pageId][select.dataset.filterId] : new Set();
    const isDefaultAll = options.length > 0 && options.every((value) => selected.has(value));
    if (pagePanel && query && isDefaultAll) label.querySelector('input[type="checkbox"]').checked = false;
    if (pagePanel && !query && isDefaultAll) label.querySelector('input[type="checkbox"]').checked = true;
    if (isVisible) visibleCount += 1;
  });
  const count = select.querySelector(".multi-select__search-count");
  if (count) count.textContent = query ? `${visibleCount}/${labels.length} 项` : `${labels.length} 项`;
  select.querySelector(".multi-select__empty")?.classList.toggle("is-hidden", visibleCount > 0);
  const allButton = select.querySelector('[data-select-action="all"]');
  const clearButton = select.querySelector('[data-select-action="clear"]');
  if (allButton) allButton.textContent = query ? "全选匹配" : "全选";
  if (clearButton) clearButton.textContent = query ? "清除匹配" : "清除";
}

function applyFilters(pageId) {
  const sectionId = document.querySelector(`[data-page-filter="${CSS.escape(pageId)}"]`)?.closest(".dashboard-section")?.id;
  if (pageId === "batch_operation_detail") {
    const panel = document.querySelector(`[data-page-filter="${CSS.escape(pageId)}"]`);
    const minText = panel?.querySelector("[data-batch-days-min]")?.value.trim() || "";
    const maxText = panel?.querySelector("[data-batch-days-max]")?.value.trim() || "";
    const minValue = minText === "" ? null : Number(minText);
    const maxValue = maxText === "" ? null : Number(maxText);
    if ((minValue !== null && (!Number.isFinite(minValue) || minValue < 0))
      || (maxValue !== null && (!Number.isFinite(maxValue) || maxValue < 0))) {
      showToast("上线天数请输入大于或等于 0 的数字");
      return;
    }
    if (minValue !== null && maxValue !== null && minValue >= maxValue) {
      showToast("“大于”天数必须小于“小于”天数");
      return;
    }
    state.batchOperationDays.minDraft = minText;
    state.batchOperationDays.maxDraft = maxText;
    state.batchOperationDays.minApplied = minValue;
    state.batchOperationDays.maxApplied = maxValue;
  }
  Object.entries(state.filterDraft[pageId]).forEach(([id, values]) => {
    state.filterApplied[pageId][id] = cloneSet(values);
  });
  if (SHARED_FILTER_PAGES.has(pageId)) {
    const configs = pageFilterConfigs(pageId);
    ["owner", "category"].forEach((kind) => {
      if (!state.sharedFilterDirty.has(kind)) return;
      const config = configs.find((item) => item.id === kind);
      if (!config) return;
      updateSharedFilter(kind, selectedSet(pageId, kind), filterOptions(pageId, config));
    });
  }
  const search = document.getElementById(`${pageId}-search`);
  if (search) state.searchDraft[pageId] = search.value;
  state.searchApplied[pageId] = state.searchDraft[pageId] || "";
  Object.keys(state.pagination).forEach((key) => { state.pagination[key] = 1; });
  closeMultiSelects();
  if (sectionId) renderCurrentPageAtSection(sectionId);
  else renderCurrentPage();
  trackUsage("filter_apply", { filter_page: pageId });
  showToast("筛选已应用");
}

function resetFilters(pageId) {
  const sectionId = document.querySelector(`[data-page-filter="${CSS.escape(pageId)}"]`)?.closest(".dashboard-section")?.id;
  const configs = pageFilterConfigs(pageId);
  configs.forEach((config) => {
    const all = new Set(unique(config.options));
    state.filterDraft[pageId][config.id] = cloneSet(all);
    state.filterApplied[pageId][config.id] = cloneSet(all);
    state.filterManual[pageId][config.id] = false;
  });
  if (SHARED_FILTER_PAGES.has(pageId)) {
    state.sharedFilters.owner = { all: true, values: new Set() };
    state.sharedFilters.category = { all: true, values: new Set() };
    state.sharedFilterDirty.delete("owner");
    state.sharedFilterDirty.delete("category");
  }
  state.searchDraft[pageId] = "";
  state.searchApplied[pageId] = "";
  if (pageId === "batch_operation_detail") {
    state.batchOperationDays.minDraft = "";
    state.batchOperationDays.maxDraft = "";
    state.batchOperationDays.minApplied = null;
    state.batchOperationDays.maxApplied = null;
  }
  Object.keys(state.pagination).forEach((key) => { state.pagination[key] = 1; });
  if (sectionId) renderCurrentPageAtSection(sectionId);
  else renderCurrentPage();
  trackUsage("filter_reset", { filter_page: pageId });
  showToast("筛选已重置");
}

function handleRootClick(event) {
  const reportFilterAction = event.target.closest("[data-report-filter-action]");
  if (reportFilterAction) {
    const report = ensureReportSelection().report;
    const filter = reportFilterAction.closest("[data-report-filter-kind]");
    const kind = filter?.dataset.reportFilterKind;
    if (!report || !kind) return;
    const options = kind === "owner" ? reportOwnerData(report).owners : visibleReportCategories(report).map((category) => category.category);
    const selected = reportFilterAction.dataset.reportFilterAction === "all" ? new Set(options) : new Set();
    if (kind === "owner") state.ui.reportOwnersDraft = selected;
    else state.ui.reportCategoriesDraft = selected;
    state.ui.reportFilterManual[kind] = true;
    state.sharedFilterDirty.add(kind);
    filter.querySelectorAll("[data-report-filter-option]").forEach((checkbox) => { checkbox.checked = selected.has(checkbox.value); });
    filter.querySelector(".report-category-filter__selection").innerHTML = reportSelectionMarkup(options, selected, kind === "owner" ? "未选择运营组长" : "未选择品类");
    return;
  }

  const reportCategoryApply = event.target.closest("[data-report-category-apply]");
  if (reportCategoryApply) {
    state.ui.reportOwnersApplied = cloneSet(state.ui.reportOwnersDraft);
    state.ui.reportCategoriesApplied = cloneSet(state.ui.reportCategoriesDraft);
    if (state.sharedFilterDirty.has("owner")) updateSharedFilter("owner", state.ui.reportOwnersApplied, reportOwnerData(ensureReportSelection().report).owners);
    if (state.sharedFilterDirty.has("category")) updateSharedFilter("category", state.ui.reportCategoriesApplied, visibleReportCategories(ensureReportSelection().report).map((category) => category.category));
    renderCurrentPageAtSection("report-attention");
    trackUsage("report_filter_apply", { filter_scope: "owner_category" });
    showToast(`已筛选 ${state.ui.reportOwnersApplied.size} 位运营组长、${state.ui.reportCategoriesApplied.size} 个品类`);
    return;
  }

  const reportCategoryReset = event.target.closest("[data-report-category-reset]");
  if (reportCategoryReset) {
    const report = ensureReportSelection().report;
    const categories = new Set(report ? visibleReportCategories(report).map((category) => category.category) : []);
    const owners = new Set(report ? reportOwnerData(report).owners : []);
    state.ui.reportOwnersDraft = owners;
    state.ui.reportOwnersApplied = cloneSet(owners);
    state.ui.reportCategoriesDraft = categories;
    state.ui.reportCategoriesApplied = cloneSet(categories);
    state.ui.reportFilterManual.owner = false;
    state.ui.reportFilterManual.category = false;
    state.sharedFilters.owner = { all: true, values: new Set() };
    state.sharedFilters.category = { all: true, values: new Set() };
    state.sharedFilterDirty.delete("owner");
    state.sharedFilterDirty.delete("category");
    renderCurrentPageAtSection("report-attention");
    trackUsage("report_filter_reset", { filter_scope: "owner_category" });
    showToast("运营组长和品类筛选已重置");
    return;
  }

  const selectButton = event.target.closest(".multi-select__button");
  if (selectButton) {
    const select = selectButton.closest(".multi-select");
    const shouldOpen = !select.classList.contains("is-open");
    closeMultiSelects(select);
    select.classList.toggle("is-open", shouldOpen);
    select.querySelector(".multi-select__menu").classList.toggle("is-hidden", !shouldOpen);
    selectButton.setAttribute("aria-expanded", String(shouldOpen));
    if (shouldOpen) window.requestAnimationFrame(() => select.querySelector(".multi-select__search")?.focus());
    return;
  }

  const selectAction = event.target.closest("[data-select-action]");
  if (selectAction) {
    const select = selectAction.closest(".multi-select");
    const checkboxes = [...select.querySelectorAll('input[type="checkbox"]')];
    const isAll = selectAction.dataset.selectAction === "all";
    const optionSearch = select.querySelector(".multi-select__search");
    const hasOptionSearch = Boolean(optionSearch?.value.trim());
    const targetCheckboxes = hasOptionSearch
      ? checkboxes.filter((box) => !box.closest(".check-option").classList.contains("is-option-hidden"))
      : checkboxes;
    const detailPanel = select.closest("[data-detail-filter]");
    let values;
    if (detailPanel) {
      const detailState = state.detailFilters[detailPanel.dataset.detailFilter];
      values = hasOptionSearch ? cloneSet(detailState.ruleDraft) : new Set();
      targetCheckboxes.forEach((box) => isAll ? values.add(box.value) : values.delete(box.value));
      detailState.ruleDraft = values;
    } else {
      const pageId = select.closest("[data-page-filter]").dataset.pageFilter;
      const filterId = select.dataset.filterId;
      const config = pageFilterConfigs(pageId).find((item) => item.id === filterId);
      const options = filterOptions(pageId, config, true);
      const isManual = state.filterManual[pageId]?.[filterId];
      // 默认全选时点“全选匹配”即开始新的手动选择；“清除匹配”则仅排除匹配项。
      values = hasOptionSearch && !isManual && isAll
        ? new Set()
        : (hasOptionSearch ? (isManual ? cloneSet(state.filterDraft[pageId][filterId]) : new Set(options)) : new Set());
      targetCheckboxes.forEach((box) => isAll ? values.add(box.value) : values.delete(box.value));
      state.filterDraft[pageId][select.dataset.filterId] = values;
      state.filterManual[pageId][filterId] = true;
      syncLinkedCategoryFilter(pageId, filterId);
      markSharedFilterDirty(pageId, filterId);
    }
    checkboxes.forEach((box) => { box.checked = values.has(box.value); });
    updateMultiSelectButton(select);
    return;
  }

  const detailQueryButton = event.target.closest("[data-detail-query]");
  if (detailQueryButton) {
    const panel = detailQueryButton.closest("[data-detail-filter]");
    const sectionId = panel.closest(".dashboard-section")?.id;
    const detailState = state.detailFilters[panel.dataset.detailFilter];
    detailState.ruleApplied = cloneSet(detailState.ruleDraft);
    const search = panel.querySelector(".search-input");
    detailState.searchDraft = search?.value || "";
    detailState.searchApplied = detailState.searchDraft;
    Object.keys(state.pagination).forEach((key) => { state.pagination[key] = 1; });
    closeMultiSelects();
    if (sectionId) renderCurrentPageAtSection(sectionId);
    else renderCurrentPage();
    trackUsage("detail_filter_apply", { detail_section: panel.dataset.detailFilter || "unknown" });
    showToast("明细筛选已应用");
    return;
  }

  const detailClearButton = event.target.closest("[data-detail-search-clear]");
  if (detailClearButton) {
    const panel = detailClearButton.closest("[data-detail-filter]");
    const sectionId = panel.closest(".dashboard-section")?.id;
    const detailState = state.detailFilters[panel.dataset.detailFilter];
    detailState.searchDraft = "";
    detailState.searchApplied = "";
    Object.keys(state.pagination).forEach((key) => { state.pagination[key] = 1; });
    if (sectionId) renderCurrentPageAtSection(sectionId);
    else renderCurrentPage();
    showToast("明细关键词已清除");
    return;
  }

  const queryButton = event.target.closest("[data-filter-query]");
  if (queryButton) {
    applyFilters(queryButton.closest("[data-page-filter]").dataset.pageFilter);
    return;
  }

  const clearSearchButton = event.target.closest("[data-search-clear]");
  if (clearSearchButton) {
    const pageId = clearSearchButton.closest("[data-page-filter]").dataset.pageFilter;
    state.searchDraft[pageId] = "";
    state.searchApplied[pageId] = "";
    Object.keys(state.pagination).forEach((key) => { state.pagination[key] = 1; });
    renderCurrentPage();
    showToast("关键词已清除");
    return;
  }

  const resetButton = event.target.closest("[data-filter-reset]");
  if (resetButton) {
    resetFilters(resetButton.closest("[data-page-filter]").dataset.pageFilter);
    return;
  }

  const invalidDetailQueryButton = event.target.closest("[data-invalid-detail-query]");
  if (invalidDetailQueryButton) {
    const panel = invalidDetailQueryButton.closest("[data-invalid-detail-filter]");
    const keyword = panel.querySelector("[data-invalid-detail-keyword]")?.value || "";
    const minText = panel.querySelector("[data-invalid-days-min]")?.value.trim() || "";
    const maxText = panel.querySelector("[data-invalid-days-max]")?.value.trim() || "";
    const minValue = minText === "" ? null : Number(minText);
    const maxValue = maxText === "" ? null : Number(maxText);
    if ((minValue !== null && (!Number.isFinite(minValue) || minValue < 0))
      || (maxValue !== null && (!Number.isFinite(maxValue) || maxValue < 0))) {
      showToast("投放天数请输入大于或等于 0 的数字");
      return;
    }
    if (minValue !== null && maxValue !== null && minValue >= maxValue) {
      showToast("“大于”天数必须小于“小于”天数");
      return;
    }
    state.invalidDetailSearch.draft = keyword;
    state.invalidDetailSearch.applied = keyword;
    state.invalidDetailDays.minDraft = minText;
    state.invalidDetailDays.maxDraft = maxText;
    state.invalidDetailDays.minApplied = minValue;
    state.invalidDetailDays.maxApplied = maxValue;
    Object.keys(state.pagination).forEach((key) => { state.pagination[key] = 1; });
    closeMultiSelects();
    renderCurrentPageAtSection("invalid-detail");
    trackUsage("detail_filter_apply", { detail_section: "invalid_activity" });
    showToast("明细筛选已应用");
    return;
  }

  const invalidDetailClearButton = event.target.closest("[data-invalid-detail-clear]");
  if (invalidDetailClearButton) {
    state.invalidDetailSearch.draft = "";
    state.invalidDetailSearch.applied = "";
    state.invalidDetailDays.minDraft = "";
    state.invalidDetailDays.maxDraft = "";
    state.invalidDetailDays.minApplied = null;
    state.invalidDetailDays.maxApplied = null;
    state.pagination["invalid-detail-table"] = 1;
    renderCurrentPageAtSection("invalid-detail");
    showToast("明细筛选已清除");
    return;
  }

  const invalidDetailDownloadButton = event.target.closest("[data-invalid-detail-download]");
  if (invalidDetailDownloadButton) {
    downloadInvalidDetailCsv();
    return;
  }

  const segmentButton = event.target.closest("[data-segment-value]");
  if (segmentButton) {
    const segment = segmentButton.closest("[data-segment]").dataset.segment;
    const value = segmentButton.dataset.segmentValue;
    if (segment === "monthly-category") state.ui.monthlyCategoryTab = value;
    if (segment === "weekly-self-invest") state.ui.weeklySelfTab = value;
    if (segment === "report-self-invest") state.ui.weeklySelfTab = value;
    if (segment === "invalid-detail") state.ui.invalidDetailTab = value;
    if (segment === "batch-summary") state.ui.batchSummaryTab = value;
    renderCurrentPage();
    document.getElementById(segment)?.scrollIntoView({ block: "start" });
    trackUsage("section_switch", { section_name: segment });
    return;
  }

  const pageButton = event.target.closest("[data-page-action]");
  if (pageButton) {
    const table = pageButton.closest("[data-table-id]");
    const id = table.dataset.tableId;
    const delta = pageButton.dataset.pageAction === "next" ? 1 : -1;
    state.pagination[id] = Math.max(1, (state.pagination[id] || 1) + delta);
    renderCurrentPage();
    document.querySelector(`[data-table-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center" });
    trackUsage("table_pagination", { table_id: id, direction: pageButton.dataset.pageAction });
  }
}

function handleRootChange(event) {
  const reportSelect = event.target.closest("[data-report-select]");
  if (reportSelect) {
    const name = reportSelect.dataset.reportSelect;
    if (name === "type") {
      state.ui.reportType = reportSelect.value;
      state.ui.reportMonth = "";
      state.ui.reportWeek = "";
    }
    if (name === "month") {
      state.ui.reportMonth = reportSelect.value;
      state.ui.reportWeek = "";
    }
    if (name === "week") state.ui.reportWeek = reportSelect.value;
    state.ui.reportSelectionId = "";
    renderCurrentPage();
    trackUsage("report_select", { selector_type: name });
    return;
  }

  const reportFilterOption = event.target.closest("[data-report-filter-option]");
  if (reportFilterOption) {
    const kind = reportFilterOption.dataset.reportFilterOption;
    let selected = kind === "owner" ? state.ui.reportOwnersDraft : state.ui.reportCategoriesDraft;
    const filter = reportFilterOption.closest(".report-category-filter");
    const isSearchActive = Boolean(filter?.querySelector("[data-report-filter-search]")?.value.trim());
    const report = ensureReportSelection().report;
    const options = kind === "owner" ? reportOwnerData(report).owners : visibleReportCategories(report).map((category) => category.category);
    const isDefaultAll = options.length > 0 && options.every((value) => selected.has(value));
    if (!state.ui.reportFilterManual[kind] || (isSearchActive && isDefaultAll)) {
      selected = isSearchActive ? new Set() : cloneSet(selected);
      if (kind === "owner") state.ui.reportOwnersDraft = selected;
      else state.ui.reportCategoriesDraft = selected;
      state.ui.reportFilterManual[kind] = true;
    }
    if (reportFilterOption.checked) selected.add(reportFilterOption.value);
    else selected.delete(reportFilterOption.value);
    state.sharedFilterDirty.add(kind);
    const selection = filter?.querySelector(".report-category-filter__selection");
    if (selection && report) selection.innerHTML = reportSelectionMarkup(options, selected, kind === "owner" ? "未选择运营组长" : "未选择品类");
    return;
  }

  const checkbox = event.target.closest('.multi-select input[type="checkbox"]');
  if (!checkbox) return;
  const select = checkbox.closest(".multi-select");
  const detailPanel = select.closest("[data-detail-filter]");
  if (detailPanel) {
    const selected = state.detailFilters[detailPanel.dataset.detailFilter].ruleDraft;
    if (checkbox.checked) selected.add(checkbox.value);
    else selected.delete(checkbox.value);
    updateMultiSelectButton(select);
    return;
  }
  const pageId = select.closest("[data-page-filter]").dataset.pageFilter;
  const filterId = select.dataset.filterId;
  let selected = state.filterDraft[pageId][filterId];
  const isSearchActive = Boolean(select.querySelector(".multi-select__search")?.value.trim());
  const config = pageFilterConfigs(pageId).find((item) => item.id === filterId);
  const options = filterOptions(pageId, config, true);
  const isDefaultAll = options.length > 0 && options.every((value) => selected.has(value));
  if (!state.filterManual[pageId]?.[filterId] || (isSearchActive && isDefaultAll)) {
    selected = isSearchActive ? new Set() : cloneSet(selected);
    state.filterDraft[pageId][filterId] = selected;
    state.filterManual[pageId][filterId] = true;
  }
  if (checkbox.checked) selected.add(checkbox.value);
  else selected.delete(checkbox.value);
  markSharedFilterDirty(pageId, filterId);
  updateMultiSelectButton(select);
  syncLinkedCategoryFilter(pageId, filterId);
}

function handleRootInput(event) {
  if (event.target.matches("[data-report-filter-search]")) {
    const keyword = event.target.value.trim().toLowerCase();
    const filter = event.target.closest(".report-category-filter");
    const kind = filter?.dataset.reportFilterKind;
    const options = kind === "owner"
      ? reportOwnerData(ensureReportSelection().report).owners
      : visibleReportCategories(ensureReportSelection().report).map((category) => category.category);
    const selected = kind === "owner" ? state.ui.reportOwnersDraft : state.ui.reportCategoriesDraft;
    const isDefaultAll = options.length > 0 && options.every((value) => selected.has(value));
    filter?.querySelectorAll("[data-report-filter-row]").forEach((row) => {
      row.hidden = keyword && !row.textContent.toLowerCase().includes(keyword);
      const checkbox = row.querySelector("[data-report-filter-option]");
      if (checkbox && keyword && isDefaultAll) checkbox.checked = false;
      if (checkbox && !keyword && isDefaultAll) checkbox.checked = true;
      if (checkbox && !isDefaultAll) checkbox.checked = selected.has(checkbox.value);
    });
    return;
  }
  if (event.target.matches("[data-invalid-detail-keyword]")) {
    state.invalidDetailSearch.draft = event.target.value;
    return;
  }
  if (event.target.matches("[data-invalid-days-min]")) {
    state.invalidDetailDays.minDraft = event.target.value;
    return;
  }
  if (event.target.matches("[data-invalid-days-max]")) {
    state.invalidDetailDays.maxDraft = event.target.value;
    return;
  }
  if (event.target.matches("[data-batch-days-min]")) {
    state.batchOperationDays.minDraft = event.target.value;
    return;
  }
  if (event.target.matches("[data-batch-days-max]")) {
    state.batchOperationDays.maxDraft = event.target.value;
    return;
  }
  if (event.target.matches(".multi-select__search")) {
    filterMultiSelectOptions(event.target);
    return;
  }
  if (!event.target.matches(".search-input")) return;
  const detailPanel = event.target.closest("[data-detail-filter]");
  if (detailPanel) {
    state.detailFilters[detailPanel.dataset.detailFilter].searchDraft = event.target.value;
    return;
  }
  const pageId = event.target.closest("[data-page-filter]").dataset.pageFilter;
  state.searchDraft[pageId] = event.target.value;
}

let sectionScrollHandler;

function setActiveSubnav(targetId) {
  subnav.querySelectorAll(".subnav-link").forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("href") === `#${targetId}`);
  });
}

function updateActiveSubnav() {
  const links = [...subnav.querySelectorAll(".subnav-link")];
  const targets = links.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
  if (!targets.length) return;
  const marker = Math.max(210, subnav.getBoundingClientRect().bottom + 14);
  let active = targets[0];
  targets.forEach((target) => {
    if (target.getBoundingClientRect().top <= marker) active = target;
  });
  const pageBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
  if (pageBottom) active = targets[targets.length - 1];
  setActiveSubnav(active.id);
}

function bindSectionObserver() {
  if (sectionScrollHandler) window.removeEventListener("scroll", sectionScrollHandler);
  let scheduled = false;
  sectionScrollHandler = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      updateActiveSubnav();
    });
  };
  window.addEventListener("scroll", sectionScrollHandler, { passive: true });
  updateActiveSubnav();
}

async function loadData() {
  loading.classList.remove("is-hidden");
  errorState.classList.add("is-hidden");
  root.innerHTML = "";
  state.weeklyReport = null;
  state.weeklyLoadError = "";
  dataStatus.className = "data-status";
  dataStatus.innerHTML = '<span class="status-dot"></span><span>正在读取数据</span>';
  try {
    const weeklyEnabled = Boolean(document.querySelector('[data-page="weekly_review"]:not([hidden])'));
    const weeklyRequest = weeklyEnabled
      ? fetch(WEEKLY_DATA_URL, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return { data: await response.json(), error: "" };
        })
        .catch((error) => ({ data: null, error: error.message || "读取失败" }))
      : Promise.resolve({ data: null, error: "" });
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    const weeklyResult = await weeklyRequest;
    state.weeklyReport = weeklyResult.data;
    state.weeklyLoadError = weeklyResult.error;
    loading.classList.add("is-hidden");
    renderCurrentPage();
  } catch (error) {
    loading.classList.add("is-hidden");
    errorState.classList.remove("is-hidden");
    document.getElementById("error-message").textContent = `无法读取 ${DATA_URL}。请通过 GitHub Pages 或本地 HTTP 服务打开页面。${error.message ? ` (${error.message})` : ""}`;
    dataStatus.classList.add("is-error");
    dataStatus.innerHTML = '<span class="status-dot"></span><span>数据加载失败</span>';
  }
}

document.querySelector(".primary-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button || button.dataset.page === state.page || !state.data) return;
  state.page = button.dataset.page;
  syncSharedFiltersToDestination(state.page);
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderCurrentPage();
  trackUsage("dashboard_navigation", { navigation_level: "primary" });
});

root.addEventListener("click", handleRootClick);
root.addEventListener("change", handleRootChange);
root.addEventListener("input", handleRootInput);
subnav.addEventListener("click", (event) => {
  const link = event.target.closest(".subnav-link");
  if (!link) return;
  setActiveSubnav(link.getAttribute("href").slice(1));
  trackUsage("dashboard_navigation", {
    navigation_level: "secondary",
    section_id: link.getAttribute("href").slice(1),
  });
  window.setTimeout(updateActiveSubnav, 50);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".multi-select")) closeMultiSelects();
  const externalLink = event.target.closest('a[target="_blank"]');
  if (externalLink) {
    trackUsage("external_link_open", {
      link_label: (externalLink.textContent || "external_link").trim().slice(0, 60),
    });
  }
});
document.getElementById("retry-button").addEventListener("click", loadData);
let reportTableResizeTimer;
window.addEventListener("resize", () => {
  window.clearTimeout(reportTableResizeTimer);
  reportTableResizeTimer = window.setTimeout(syncReportTableWidths, 80);
}, { passive: true });

loadData();
