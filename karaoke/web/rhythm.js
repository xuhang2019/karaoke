import {rhythmLines, blockGeometry, compareHolds, HoldRecorder} from './rhythm-core.js';

const $ = id => document.getElementById(id);
const recorder = new HoldRecorder();
let lines = [], buffers = [], index = 0, context, sources = [], anchor = null, run = 0, frame;
let requestController, loadId = 0, songs = [], origin = 0, end = 0, heldBy = null;
let localAudio = null, localCues = null, sessionTitle = '';
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('karaoke-rhythm') : null;
channel?.addEventListener('message', () => stop());
const pps = () => $('zoom').value === 'fit' ? Math.max(1, $('viewport').clientWidth - 2) / Math.max(.1, end - origin) : Number($('zoom').value);
const line = () => lines[index];
const status = text => { $('status').textContent = text; };
const playing = () => anchor !== null && context?.state === 'running';
const clock = () => anchor === null ? origin : context.currentTime - (context.baseLatency || 0) - (context.outputLatency || 0) - anchor;
const signed = seconds => `${seconds >= 0 ? '+' : '−'}${Math.abs(seconds * 1000).toFixed(0)} ms`;

function audioContext() {
  context ||= new AudioContext();
  context.onstatechange = () => {
    if (anchor !== null && context.state !== 'running') { stop(); status('声音已中断，点击播放这一句重练'); }
  };
  return context;
}

function controls() {
  const ready = Boolean(lines.length && buffers.length);
  $('play').disabled = !ready; $('pad').disabled = !ready;
  $('previous').disabled = !ready || index === 0;
  $('next').disabled = !ready || index === lines.length - 1;
  $('stop').disabled = anchor === null;
}

function place(element, unit) {
  const geometry = blockGeometry(unit, origin, pps());
  element.style.left = `${geometry.left}px`;
  element.style.width = `${geometry.width}px`;
}

function renderLine() {
  controls();
  if (!line()) return;
  origin = Math.max(0, line().start - 1);
  end = line().end + .35;
  $('counter').textContent = `第 ${index + 1} / ${lines.length} 句`;
  $('lyric').textContent = line().text;
  $('next-line').textContent = lines[index + 1] ? `下一句：${lines[index + 1].text}` : '最后一句 · 可以再练一次';
  $('timeline').style.width = `${(end - origin) * pps()}px`;
  $('timeline').style.setProperty('--pps', `${pps()}px`);
  $('blocks').replaceChildren();
  line().units.forEach(unit => {
    const block = document.createElement('div'); block.className = 'block';
    block.title = `${unit.text} · ${(unit.end - unit.start).toFixed(3)} 秒`;
    const label = document.createElement('span'); label.textContent = unit.text;
    block.append(label); place(block, unit);
    label.style.fontSize = `${Math.min(22, Math.max(9, (unit.end - unit.start) * pps() / [...unit.text].length - 2))}px`;
    $('blocks').append(block);
  });
  $('timeline').querySelectorAll('.tick').forEach(el => el.remove());
  for (let second = 0; second <= end - origin; second++) {
    const tick = document.createElement('span'); tick.className = 'tick';
    tick.textContent = `${second}s`; tick.style.left = `${second * pps() + 4}px`;
    $('timeline').append(tick);
  }
  $('holds').replaceChildren(); $('results').replaceChildren(); $('cursor').hidden = true;
  $('viewport').scrollLeft = 0;
  $('clock').textContent = '0.00 s';
  status(`${sessionTitle}${line().estimated ? ' · 本句含上游估算时间，仅供参考' : ''}`);
}

function drawHolds(time) {
  const intervals = [...recorder.holds];
  if (recorder.active !== null) intervals.push({start:recorder.active, end:Math.max(recorder.active, time)});
  while ($('holds').children.length < intervals.length) {
    const el = document.createElement('div'); el.className = 'hold'; $('holds').append(el);
  }
  intervals.forEach((hold, i) => place($('holds').children[i], hold));
}

function release() {
  recorder.up(Math.min(end, clock())); heldBy = null;
  $('pad').setAttribute('aria-pressed', 'false');
  $('pad').querySelector('strong').textContent = '按住空格';
}
function press(owner) {
  if (!playing() || heldBy !== null || clock() < origin || clock() >= end) return;
  heldBy = owner; recorder.down(clock());
  $('pad').setAttribute('aria-pressed', 'true');
  $('pad').querySelector('strong').textContent = '保持按住…';
}

function stop() {
  run++; cancelAnimationFrame(frame);
  if (anchor !== null) { release(); drawHolds(Math.min(end, clock())); }
  anchor = null;
  for (const source of sources) { try { source.stop(); } catch { /* already finished */ } source.disconnect(); }
  sources = []; controls();
}

function report() {
  const result = compareHolds(line().units, recorder.holds);
  const summary = document.createElement('p');
  summary.textContent = `本句完成 · 漏按 ${result.words.filter(w => w.missed).length} 个 · 多按 ${result.extra} 次`;
  const table = document.createElement('table');
  const row = values => { const tr = document.createElement('tr'); values.forEach(value => {
    const td = document.createElement('td'); td.textContent = value; tr.append(td);
  }); return tr; };
  const head = document.createElement('thead'); head.append(row(['字 / 词','原唱时长','按压时长','起点偏差','长短偏差'])); table.append(head);
  const body = document.createElement('tbody');
  result.words.forEach(w => body.append(row([w.text, `${w.target.toFixed(2)} s`, w.missed ? '漏按' : `${w.actual.toFixed(2)} s`,
    w.missed ? '—' : signed(w.onset), w.missed ? '—' : signed(w.duration)])));
  table.append(body); $('results').replaceChildren(summary, table);
}

function tick(token) {
  if (token !== run || !playing()) return;
  const time = Math.min(end, clock());
  const x = Math.max(0, (time - origin) * pps());
  $('cursor').hidden = false; $('cursor').style.left = `${x}px`;
  $('clock').textContent = `${Math.max(0, time - origin).toFixed(2)} s`;
  [...$('blocks').children].forEach((block, i) => {
    const unit = line().units[i];
    block.classList.toggle('active', time >= unit.start && time < unit.end);
    block.classList.toggle('done', time >= unit.end);
  });
  drawHolds(Math.min(time, end));
  const viewport = $('viewport');
  if (x > viewport.scrollLeft + viewport.clientWidth - 55) viewport.scrollLeft = Math.max(0, x - viewport.clientWidth * .35);
  if (time >= end) {
    const repeat = $('loop').checked;
    stop(); report();
    if (repeat) { const ended = run; setTimeout(() => { if (run === ended && !document.hidden && $('loop').checked) start(); }, 1200); }
    return;
  }
  frame = requestAnimationFrame(() => tick(token));
}

async function start() {
  if (!lines.length || !buffers.length) return;
  stop(); const token = run;
  try {
    await audioContext().resume();
    if (token !== run || context.state !== 'running') return;
    channel?.postMessage('playing');
    recorder.reset(); renderLine();
    // All stems and input timestamps use the same audio clock, including output latency.
    const when = context.currentTime + .08;
    anchor = when - origin;
    for (const buffer of buffers) {
      const source = context.createBufferSource(); source.buffer = buffer;
      source.connect(context.destination); source.start(when, origin, Math.min(end, buffer.duration) - origin);
      sources.push(source);
    }
    controls(); frame = requestAnimationFrame(() => tick(token));
  } catch (error) { stop(); status(`无法播放：${error.message}`); }
}

function beginLoad() {
  stop(); requestController?.abort(); requestController = new AbortController();
  lines = []; buffers = []; controls(); $('blocks').replaceChildren(); $('holds').replaceChildren(); $('results').replaceChildren();
  $('lyric').textContent = '正在加载…'; $('next-line').textContent = ''; $('counter').textContent = '第 — 句';
  return ++loadId;
}
function install(cues, audio, title) {
  const parsed = rhythmLines(cues);
  if (audio.some(b => parsed.some(l => l.end > b.duration + .05))) throw new Error('时间轴超出音频长度，请核对录音版本');
  lines = parsed; buffers = audio; sessionTitle = title; index = 0; recorder.reset(); renderLine();
}
async function json(url, signal) {
  const response = await fetch(url, {signal});
  if (!response.ok) throw new Error(`读取失败 (${response.status})`);
  return response.json();
}
async function loadSong(song) {
  const token = beginLoad(), signal = requestController.signal;
  status('加载原唱和逐字时间轴…');
  try {
    if (song.lyrics_unavailable) throw new Error('这首歌没有逐字歌词');
    const keys = song.artifacts.accompaniment ? ['accompaniment','lead_vocals'] : ['instrumental','backing_vocals','lead_vocals'];
    if (!song.artifacts.subtitles || keys.some(k => !song.artifacts[k])) throw new Error('缺少音轨或时间轴');
    const [cues, ...audio] = await Promise.all([json(song.artifacts.subtitles, signal), ...keys.map(async key => {
      const response = await fetch(song.artifacts[key], {signal});
      if (!response.ok) throw new Error(`音轨读取失败 (${response.status})`);
      return audioContext().decodeAudioData(await response.arrayBuffer());
    })]);
    if (token !== loadId) return;
    install(cues, audio, `${song.title}${song.lyrics_need_review ? ' · 上游标记歌词待校对' : ''}`);
  } catch (error) { if (token === loadId) { $('lyric').textContent = '暂时无法练习这首歌'; status(error.message); } }
}
async function refreshSongs() {
  if (document.body.dataset.static === 'true') {
    $('songs').parentElement.hidden = true; $('refresh').hidden = true; return;
  }
  $('refresh').disabled = true;
  try {
    const room = await json('/v1/room');
    songs = [...new Map([...(room.library || []), ...(room.entries || [])].filter(s => s.status === 'completed').map(s => [s.job_id,s])).values()];
    $('songs').replaceChildren(new Option(songs.length ? '选择一首已对齐的歌' : '曲库为空 · 可试用示例或导入文件', ''));
    songs.forEach((song, i) => $('songs').append(new Option(`${song.title} ${song.artist || ''}`, String(i))));
  } catch { $('songs').replaceChildren(new Option('未连接曲库 · 可试用示例或导入文件','')); }
  finally { $('refresh').disabled = false; }
}

$('songs').onchange = () => { if ($('songs').value !== '') loadSong(songs[Number($('songs').value)]); };
$('refresh').onclick = refreshSongs;
$('play').onclick = start; $('stop').onclick = stop;
function step(delta) { stop(); index = Math.max(0, Math.min(lines.length - 1, index + delta)); recorder.reset(); renderLine(); }
$('previous').onclick = () => step(-1); $('next').onclick = () => step(1);
$('zoom').onchange = () => { stop(); recorder.reset(); renderLine(); };
$('fullscreen').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { status('此浏览器不支持全屏，可使用浏览器的全屏功能'); }
};
$('pad').onpointerdown = event => {
  if (event.button !== 0 || heldBy !== null) return;
  event.preventDefault(); $('pad').setPointerCapture(event.pointerId); press(`pointer:${event.pointerId}`);
};
for (const name of ['pointerup','pointercancel','lostpointercapture']) $('pad').addEventListener(name, event => {
  if (heldBy === `pointer:${event.pointerId}`) release();
});
$('pad').oncontextmenu = event => event.preventDefault();
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.target.isContentEditable ||
      ['INPUT','TEXTAREA','SELECT','SUMMARY'].includes(event.target.tagName)) return;
  if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) press('keyboard'); }
  if (event.repeat) return;
  if (event.code === 'Enter' && event.target.tagName !== 'BUTTON') { event.preventDefault(); start(); }
  if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') { event.preventDefault(); step(event.code === 'ArrowLeft' ? -1 : 1); }
});
document.addEventListener('keyup', event => { if (event.code === 'Space' && heldBy === 'keyboard') { event.preventDefault(); release(); } });
window.addEventListener('blur', () => { if (playing()) { stop(); status('窗口已失去焦点，点击播放这一句重练'); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
window.addEventListener('resize', () => { if (lines.length) { stop(); recorder.reset(); renderLine(); } });
window.addEventListener('pagehide', () => { stop(); requestController?.abort(); channel?.close(); });

async function importLocal() {
  if (!localAudio || !localCues) { status('再选择同一录音的音频或 cues.json'); return; }
  const audioFile = localAudio, cueFile = localCues, token = beginLoad();
  try {
    const [cues, audio] = await Promise.all([cueFile.text().then(JSON.parse), audioFile.arrayBuffer().then(data => audioContext().decodeAudioData(data))]);
    if (token === loadId) install(cues, [audio], `${audioFile.name} · 本地文件`);
  } catch (error) { if (token === loadId) { $('lyric').textContent = '导入失败'; status(error.message); } }
}
$('audio-file').onchange = event => { localAudio = event.target.files[0]; importLocal(); };
$('cue-file').onchange = event => { localCues = event.target.files[0]; importLocal(); };
$('demo').onclick = () => {
  beginLoad();
  const cues = [
    {text:'短、短、长——停，再来', units:[{text:'短',start:1,end:1.25},{text:'短',start:1.5,end:1.75},{text:'长',start:2,end:3.5},{text:'再',start:4,end:4.4},{text:'来',start:4.4,end:5.2}]},
    {text:'轻轻敲，慢慢留', units:[{text:'轻',start:7,end:7.3},{text:'轻',start:7.3,end:7.6},{text:'敲',start:7.8,end:8.4},{text:'慢',start:8.8,end:9.6},{text:'慢',start:9.6,end:10.4},{text:'留',start:10.4,end:11.7}]},
  ];
  const audio = audioContext().createBuffer(1, audioContext().sampleRate * 13, audioContext().sampleRate);
  const data = audio.getChannelData(0), rate = audio.sampleRate;
  cues.flatMap(c => c.units).forEach((unit, i) => {
    const first = Math.round(unit.start * rate), last = Math.round(unit.end * rate);
    for (let sample = first; sample < last; sample++) {
      const envelope = Math.min(1, (sample - first) / (rate * .008), (last - sample) / (rate * .015));
      data[sample] = .12 * envelope * Math.sin(2 * Math.PI * [330,392,440,392,330][i % 5] * (sample - first) / rate);
    }
  });
  install(cues, [audio], '节奏示例 · 合成提示音，非歌曲对齐结果');
};
// Keep the first visit useful even when the upstream library is empty.
refreshSongs();
