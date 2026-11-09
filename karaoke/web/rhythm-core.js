// Display measured units verbatim: never infer character times from a lyric line.
export function rhythmLines(cues) {
  if (!Array.isArray(cues) || !cues.length) throw new Error('没有可用的逐字时间轴');
  return cues.map((cue, index) => {
    const units = cue.units;
    if (!Array.isArray(units) || !units.length) throw new Error(`第 ${index + 1} 句缺少逐字时间；请先完成原项目的对齐`);
    if (units.some((u, i) => !Number.isFinite(u.start) || !Number.isFinite(u.end) || u.start < 0 || u.end <= u.start ||
        typeof u.text !== 'string' || !u.text.trim() || (i && u.start < units[i - 1].start)))
      throw new Error(`第 ${index + 1} 句的时间轴无效`);
    return {text:cue.text, units:units.map(u => ({...u})), start:units[0].start,
      end:Math.max(...units.map(u => u.end)), estimated:units.some(u => u.timing_source === 'linear_fallback')};
  });
}

export function blockGeometry(unit, origin, pixelsPerSecond) {
  return {left:(unit.start - origin) * pixelsPerSecond, width:(unit.end - unit.start) * pixelsPerSecond};
}

// Chronological one-to-one matching. A hold spanning two words cannot earn two hits.
export function compareHolds(units, holds, tolerance = .25) {
  const n = units.length, m = holds.length;
  const cost = Array.from({length:n + 1}, () => Array(m + 1).fill(Infinity));
  const path = Array.from({length:n + 1}, () => Array(m + 1));
  cost[0][0] = 0;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
    const update = (a, b, value, action) => {
      if (value < cost[a][b]) { cost[a][b] = value; path[a][b] = action; }
    };
    if (i < n) update(i + 1, j, cost[i][j] + tolerance, 'miss');
    if (j < m) update(i, j + 1, cost[i][j] + tolerance, 'extra');
    if (i < n && j < m) {
      const delta = Math.abs(units[i].start - holds[j].start);
      if (delta <= tolerance) update(i + 1, j + 1, cost[i][j] + delta, 'match');
    }
  }
  const matches = new Map();
  let i = n, j = m;
  while (i || j) {
    const action = path[i][j];
    if (action === 'match') { matches.set(i - 1, holds[j - 1]); i--; j--; }
    else if (action === 'miss') i--;
    else j--;
  }
  const words = units.map((unit, index) => {
    const hold = matches.get(index);
    if (!hold) return {text:unit.text, missed:true, target:unit.end - unit.start};
    return {text:unit.text, missed:false, onset:hold.start - unit.start,
      duration:(hold.end - hold.start) - (unit.end - unit.start),
      actual:hold.end - hold.start, target:unit.end - unit.start};
  });
  return {words, extra:holds.length - matches.size};
}

export class HoldRecorder {
  constructor() { this.reset(); }
  reset() { this.holds = []; this.active = null; }
  down(time) {
    if (this.active !== null || !Number.isFinite(time)) return false;
    this.active = time;
    return true;
  }
  up(time) {
    if (this.active === null) return false;
    if (Number.isFinite(time) && time > this.active) this.holds.push({start:this.active, end:time});
    this.active = null;
    return true;
  }
}
