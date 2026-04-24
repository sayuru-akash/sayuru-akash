#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAYS = [
  { full: "Sunday", short: "Sun" },
  { full: "Monday", short: "Mon" },
  { full: "Tuesday", short: "Tue" },
  { full: "Wednesday", short: "Wed" },
  { full: "Thursday", short: "Thu" },
  { full: "Friday", short: "Fri" },
  { full: "Saturday", short: "Sat" },
];

const THEMES = {
  light: {
    bg: "#ffffff",
    frame: "#d0d7de",
    title: "#24292f",
    text: "#57606a",
    subtle: "#656d76",
    legend: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
  },
  dark: {
    bg: "#0d1117",
    frame: "#30363d",
    title: "#c9d1d9",
    text: "#8b949e",
    subtle: "#8b949e",
    legend: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
  },
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args[key] = "";
      continue;
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toUtcDate(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function buildMonthLabels(startDate, endDate, calendarStart) {
  const labels = [{ label: MONTHS[startDate.getUTCMonth()], weekIndex: 0 }];

  let cursor = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 1),
  );
  while (cursor <= endDate) {
    const weekIndex = Math.floor(
      (cursor.getTime() - calendarStart.getTime()) / (7 * DAY_MS),
    );
    const last = labels[labels.length - 1];
    if (weekIndex >= 0 && (!last || weekIndex - last.weekIndex >= 2)) {
      labels.push({ label: MONTHS[cursor.getUTCMonth()], weekIndex });
    }
    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
    );
  }

  return labels;
}

async function fetchContributionTotal(username, token) {
  if (!token) {
    return null;
  }

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `bearer ${token}`,
    },
    body: JSON.stringify({
      query: `query($login: String!) {
        user(login: $login) {
          contributionsCollection {
            contributionCalendar {
              totalContributions
            }
          }
        }
      }`,
      variables: { login: username },
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const total =
    payload?.data?.user?.contributionsCollection?.contributionCalendar
      ?.totalContributions;
  return Number.isFinite(total) ? total : null;
}

const args = parseArgs(process.argv.slice(2));

if (!args.input || !args.output) {
  throw new Error(
    "Usage: node scripts/build-detailed-snake.mjs --input <input.svg> --output <output.svg> [--theme light|dark] [--username name]",
  );
}

const theme = args.theme === "dark" ? "dark" : "light";
const palette = THEMES[theme];
const username =
  args.username || process.env.GITHUB_REPOSITORY_OWNER || "github-user";
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

const source = await readFile(args.input, "utf8");
const match = source.match(
  /<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>\s*$/i,
);
if (!match) {
  throw new Error(`Could not parse SVG: ${args.input}`);
}

const baseViewBox = match[1];
const innerSvg = match[2].replace(/<desc>[\s\S]*?<\/desc>/gi, "");

if (
  source.includes('class="card-bg"') ||
  source.includes(">Contribution Graph<")
) {
  throw new Error(
    `Input appears to be an already wrapped detailed SVG (${args.input}). Use raw snk output (for example dist/.snake-base.svg).`,
  );
}

const [viewX, viewY, viewWidth, viewHeight] = baseViewBox
  .split(/\s+/)
  .map((value) => Number.parseFloat(value));

if (
  ![viewX, viewY, viewWidth, viewHeight].every((value) =>
    Number.isFinite(value),
  )
) {
  throw new Error(`Invalid viewBox in ${args.input}: ${baseViewBox}`);
}

const today = toUtcDate(new Date());
const startDate = new Date(today);
startDate.setUTCDate(startDate.getUTCDate() - 364);
const calendarStart = new Date(startDate);
calendarStart.setUTCDate(
  calendarStart.getUTCDate() - calendarStart.getUTCDay(),
);

const monthLabels = buildMonthLabels(startDate, today, calendarStart);
const totalContributions = await fetchContributionTotal(username, token);
const hasRealTotal = Number.isFinite(totalContributions);
const prettyTotal = hasRealTotal
  ? new Intl.NumberFormat("en-US").format(totalContributions)
  : "";
const countText = hasRealTotal
  ? `<text class="count-text" x="24" y="74">${prettyTotal} contributions in the last year</text>`
  : "";
const dayOfWeekY = hasRealTotal ? 92 : 74;
const descText = hasRealTotal
  ? `${prettyTotal} contributions in the last year with month and weekday labels and an animated snake.`
  : "Contribution graph with month and weekday labels and an animated snake.";

const layout = {
  left: 124,
  right: 28,
  top: 100,
  bottom: 48,
};

const graphX = layout.left;
const graphY = layout.top;
const width = Math.round(layout.left + viewWidth + layout.right);
const height = Math.round(layout.top + viewHeight + layout.bottom);

const monthBaseline = graphY + (2 - viewY) - 18;
const dayBaseline = graphY + (2 - viewY) + 9;
const dayLabelX = 24;
const legendY = height - 22;
const legendStart = width - 220;
const legendBoxY = legendY - 10;

const monthTexts = monthLabels
  .map(({ label, weekIndex }) => {
    const x = graphX + (2 + weekIndex * 16 - viewX);
    if (x < graphX + 8 || x > width - 24) {
      return "";
    }
    return `<text class="axis-text" x="${x}" y="${monthBaseline}">${label}</text>`;
  })
  .join("");

const dayTexts = DAYS.map((day, rowIndex) => {
  const y = dayBaseline + rowIndex * 16;
  return `<text class="day-text" x="${dayLabelX}" y="${y}">${day.short}</text>`;
}).join("");

const legendBoxes = palette.legend
  .map((color, index) => {
    const x = legendStart + 38 + index * 16;
    return `<rect x="${x}" y="${legendBoxY}" width="10" height="10" rx="2" ry="2" fill="${color}" stroke="${palette.frame}" stroke-width="0.5"/>`;
  })
  .join("");

const ownerLabel = escapeXml(username);

const output = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="title desc">
  <title id="title">${ownerLabel} contribution graph snake</title>
  <desc id="desc">${escapeXml(descText)}</desc>
  <style>
    .card-bg { fill: ${palette.bg}; stroke: ${palette.frame}; stroke-width: 1; }
    .title-text { fill: ${palette.title}; font: 600 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .subtle-text { fill: ${palette.subtle}; font: 500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .count-text { fill: ${palette.title}; font: 600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .axis-text { fill: ${palette.text}; font: 500 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .day-text { fill: ${palette.text}; font: 500 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .legend-text { fill: ${palette.text}; font: 500 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .snake-canvas .u { display: none !important; }
  </style>

  <rect class="card-bg" x="8" y="8" width="${width - 16}" height="${height - 16}" rx="10" ry="10"/>

  <text class="title-text" x="24" y="52">Contribution Graph</text>
  ${countText}
  <text class="subtle-text" x="24" y="${dayOfWeekY}">Day of Week</text>

  ${monthTexts}
  ${dayTexts}

  <svg class="snake-canvas" x="${graphX}" y="${graphY}" width="${viewWidth}" height="${viewHeight}" viewBox="${baseViewBox}" aria-hidden="true">
    ${innerSvg}
  </svg>

  <g aria-hidden="true">
    <text class="legend-text" x="${legendStart}" y="${legendY}">Less</text>
    ${legendBoxes}
    <text class="legend-text" x="${legendStart + 128}" y="${legendY}">More</text>
  </g>
</svg>
`;

await writeFile(args.output, output, "utf8");
