/**
 * Divide a daily values series into fixed sub-period levels.
 * W (7) → daily segments, M (30) → weekly, 6M (180) → monthly.
 * Returns array of { startIdx, endIdx, average, percentChange }.
 */
export function computeLevels(values, dates, timeframeDays) {
  const segments = buildSegments(values, dates, timeframeDays);

  let prevAvg = null;
  return segments.map(seg => {
    const nonNull = seg.values.filter(v => v !== null && v !== undefined);

    // For M/6M, omit segments with < 2 data points
    if (timeframeDays > 7 && nonNull.length < 2) {
      return null;
    }

    const average = nonNull.length > 0
      ? nonNull.reduce((s, v) => s + v, 0) / nonNull.length
      : null;

    let percentChange = null;
    if (average !== null && prevAvg !== null && prevAvg !== 0) {
      percentChange = ((average - prevAvg) / Math.abs(prevAvg)) * 100;
    }

    if (average !== null) prevAvg = average;

    return { startIdx: seg.startIdx, endIdx: seg.endIdx, average, percentChange };
  }).filter(Boolean);
}

function buildSegments(values, dates, timeframeDays) {
  if (timeframeDays <= 7) {
    return values.map((v, i) => ({
      startIdx: i,
      endIdx: i,
      values: [v],
    }));
  }

  const getKey = timeframeDays <= 30 ? getWeekKey : timeframeDays <= 90 ? getBiweekKey : getMonthKey;
  const segments = [];
  let currentKey = null;
  let currentSeg = null;

  for (let i = 0; i < dates.length; i++) {
    const key = getKey(dates[i]);
    if (key !== currentKey) {
      if (currentSeg) segments.push(currentSeg);
      currentKey = key;
      currentSeg = { startIdx: i, endIdx: i, values: [] };
    }
    currentSeg.endIdx = i;
    currentSeg.values.push(values[i]);
  }
  if (currentSeg) segments.push(currentSeg);

  return segments;
}

function getWeekKey(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

function getBiweekKey(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff); // Monday of this week
  const weekNum = Math.floor(d.getDate() / 14); // group pairs of weeks within each month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${weekNum}`;
}

function getMonthKey(dateStr) {
  return dateStr.slice(0, 7);
}

/**
 * Color for a level segment based on whether the change is favorable.
 * Supplements: up = green, down = yellow.
 * Symptoms: down = green, up = yellow.
 * < 2% or null = grey.
 */
export function getLevelColor(percentChange, isSymptom) {
  if (percentChange === null || percentChange === undefined || Math.abs(percentChange) < 2) {
    return '#9ca3af';
  }
  const favorable = isSymptom ? percentChange < 0 : percentChange > 0;
  return favorable ? '#34d399' : '#d4a017';
}

/**
 * Generate insight stats and natural language text.
 * primaryStats: { name, average, priorAverage, unit, isSymptom }
 * secondaryStats: array of same shape
 * options: { timeframeLabel }
 * Returns { average, unit, percentChange, priorAverage, insightText }
 */
export function computeInsight(primaryStats, secondaryStats, options) {
  const { name, average, priorAverage, unit, isSymptom } = primaryStats;
  const { timeframeLabel } = options;

  let percentChange = null;
  if (priorAverage && priorAverage !== 0) {
    percentChange = ((average - priorAverage) / Math.abs(priorAverage)) * 100;
  }

  // Build insight as array of { text, color? } segments for rich rendering
  const formattedAvg = Number.isInteger(average) ? average : average.toFixed(1);
  const unitStr = unit === '/5' ? '/5' : ' ' + unit;
  const insightSegments = [];

  if (percentChange !== null && Math.abs(percentChange) >= 2) {
    const direction = percentChange > 0 ? 'above' : 'below';
    const pct = Math.abs(Math.round(percentChange));
    const formattedPrior = Number.isInteger(priorAverage) ? priorAverage : priorAverage.toFixed(1);
    const color = getLevelColor(percentChange, isSymptom);
    insightSegments.push(
      { text: `Your average ${name} (${formattedAvg}${unitStr}) was ` },
      { text: `${pct}% ${direction}`, color },
      { text: ` your previous ${timeframeLabel} average of ${formattedPrior}.` },
    );
  } else {
    insightSegments.push(
      { text: `Your average ${name} was ${formattedAvg}${unitStr} over this period.` },
    );
  }

  // Correlation hints
  const significantSecondaries = secondaryStats.filter(s => {
    if (!s.priorAverage || s.priorAverage === 0) return false;
    const pct = ((s.average - s.priorAverage) / Math.abs(s.priorAverage)) * 100;
    return Math.abs(pct) >= 2;
  });

  if (percentChange !== null && Math.abs(percentChange) >= 2 && significantSecondaries.length > 0) {
    const primaryUp = percentChange > 0;
    const favorablePairs = significantSecondaries.filter(s => {
      const secPct = ((s.average - s.priorAverage) / Math.abs(s.priorAverage)) * 100;
      const secUp = secPct > 0;
      if (isSymptom !== s.isSymptom) {
        return primaryUp !== secUp;
      }
      const primaryGood = isSymptom ? !primaryUp : primaryUp;
      const secGood = s.isSymptom ? !secUp : secUp;
      return primaryGood && secGood;
    });

    if (favorablePairs.length > 0) {
      insightSegments.push({ text: ' ' });
      favorablePairs.forEach((s, i) => {
        const pct = Math.abs(Math.round(((s.average - s.priorAverage) / Math.abs(s.priorAverage)) * 100));
        const dir = s.isSymptom
          ? (s.average < s.priorAverage ? 'down' : 'up')
          : (s.average > s.priorAverage ? 'up' : 'down');
        const sColor = getLevelColor(((s.average - s.priorAverage) / Math.abs(s.priorAverage)) * 100, s.isSymptom);
        if (i > 0) insightSegments.push({ text: ', ' });
        insightSegments.push(
          { text: `${s.name} ` },
          { text: `${dir} ${pct}%`, color: sColor },
        );
      });
      insightSegments.push({ text: ' — these trends moved in a favorable direction together.' });
    }
  }

  // Plain text version for backwards compat / tests
  const insightText = insightSegments.map(seg => seg.text).join('');

  return { average, unit, percentChange, priorAverage, insightText, insightSegments };
}
