// App logic extracted from index.html
// --- Data model per specification
// Dual-layer data model: operating + capital percentages for each sector
// Updated city shares (percent) for 2025 derived from the attached Operating and Capital CSVs.
// Mapping used (confirmed):
// - Transit -> Transit Commission / Transit Services
// - Housing -> Housing and Homelessness Services + Strategic Housing + Housing Solutions
// - Policing -> Ottawa Police Service
// - Health & Social -> Ottawa Public Health + Paramedic Service + Long Term Care
// - Parks & Culture -> Ottawa Public Library + Parks + Community Recreation
// - Environment -> Solid Waste + Climate Change & Resiliency + Forestry (and committee totals)
// Values were computed from the 2025 column in the Operating CSV and the 2025 column in the Capital CSV.
const sectors = [
  // Operating ~ computed shares: Transit 34%, Housing 12%, Policing 29%, Health & Social 10%, Parks & Culture 12%, Environment 3%
  // Capital ~ computed shares: Transit 68%, Parks & Culture 22%, Housing 4%, Policing 3%, Environment 2%, Health & Social 1%
  { name: 'Transit', icon: '🚌', city: { operating: 34, capital: 68 } },
  { name: 'Housing', icon: '🏠', city: { operating: 12, capital: 4 } },
  { name: 'Policing', icon: '👮', city: { operating: 29, capital: 3 } },
  { name: 'Health & Social', icon: '❤️', city: { operating: 10, capital: 1 } },
  { name: 'Parks & Culture', icon: '🌳', city: { operating: 12, capital: 22 } },
  { name: 'Environment', icon: '🌎', city: { operating: 3, capital: 2 } }
];

// Ensure city-provided percentages sum to 100 for each layer (normalize if not).
function normalizeCityShares(){
  ['operating','capital'].forEach(layer=>{
    const vals = sectors.map(s => (s.city && typeof s.city[layer] === 'number') ? s.city[layer] : 0);
    const sum = vals.reduce((a,b)=>a+b,0);
    if(sum === 0) return; // nothing to normalize
    // compute proportional rounded shares then fix rounding error on first element
    const scaled = vals.map(v => Math.round((v/sum)*100));
    let s = scaled.reduce((a,b)=>a+b,0);
    if(s !== 100){ const diff = 100 - s; scaled[0] = (scaled[0]||0) + diff; }
    // write back
    sectors.forEach((sec,i)=>{ if(!sec.city) sec.city = {}; sec.city[layer] = scaled[i]; });
  });
}

// run normalization immediately so UI and charts use 100%-normalized city shares
normalizeCityShares();

const player = { blindAllocations: [], adjustedAllocations: [] };
let activeLayer = localStorage.getItem('activeLayer') || 'operating';
// Ensure player storage supports both layers
player.blindAllocations = { operating: [], capital: [] };
player.adjustedAllocations = { operating: [], capital: [] };
const BUDGET = 100;

// --- Scene management
const scenes = ['intro','debrief','revenue','blind','adjust','compare'];
let currentSceneIndex = 0;
function showScene(name){
  scenes.forEach(s => {
    const el = document.getElementById('scene-' + s);
    if(!el) return;
    el.classList.toggle('active', s === name);
  });
  currentSceneIndex = scenes.indexOf(name);
  updateAdvisorForScene(name);
  // If revenue scene became active, force a chart resize and redraw (Chart.js may have initialized while hidden)
  if(name === 'revenue'){
    try{ initRevenueChart(); const canvas = document.getElementById('revenueChart'); if(canvas) canvas.focus(); }catch(e){ console.error('Error initializing revenue chart', e); }
  }
  // When showing blind scene, ensure controls are active and totals updated
  if(name === 'blind'){
    try{ blindControls.querySelectorAll('input[type=range]').forEach(el=> el.disabled = false); updateBlindTotals(); }
    catch(e){ console.error('Error preparing blind scene', e); }
  }
  // update layer toggle UI state
  try{ document.getElementById('toggleOperating').classList.toggle('active', activeLayer === 'operating'); document.getElementById('toggleCapital').classList.toggle('active', activeLayer === 'capital'); }catch(e){}
}

// --- Advisor text per scene
const advisorTextEl = document.getElementById('advisorText');
function updateAdvisorForScene(name){
  const map = {
    intro: 'Welcome — you will help decide how Ottawa allocates its budget. Click Start to begin.',
  debrief: `You have $${getLayerTotalM(activeLayer)}M to distribute. Think about services that affect daily life: transit, housing, safety, and the environment.`,
  blind: 'Trust your instincts. Move the sliders to make your ideal city. The labels are minimal to avoid bias.',
  revenue: 'This shows where the city gets its money. Click a slice to learn more about each source.',
    adjust: 'Here are short context notes for each sector. Adjust your allocations with this new information.',
    compare: 'Here are your results and how they compare to the City of Ottawa budgets.'
  };
  advisorTextEl.textContent = map[name] || '';
}

// --- Wire up scene buttons
document.getElementById('startBtn').addEventListener('click', () => showScene('debrief'));
document.getElementById('debriefContinue').addEventListener('click', () => showScene('revenue'));
document.getElementById('debriefSkip').addEventListener('click', () => showScene('blind'));

// Layer toggle handlers
document.getElementById('toggleOperating').addEventListener('click', () => { setActiveLayer('operating'); });
document.getElementById('toggleCapital').addEventListener('click', () => { setActiveLayer('capital'); });

// Ensure the layer toggle shows the active layer on load
try{ document.getElementById('toggleOperating').classList.toggle('active', activeLayer === 'operating'); document.getElementById('toggleCapital').classList.toggle('active', activeLayer === 'capital'); }catch(e){}

function setActiveLayer(layer){
  if(!['operating','capital'].includes(layer)) return;
  // If the user is mid-edit (blind/adjust) and hasn't submitted for the current layer, confirm
  const editing = (document.getElementById('scene-blind').classList.contains('active') || document.getElementById('scene-adjust').classList.contains('active'));
  const hasUnsaved = (()=>{
    const blindVals = player.blindAllocations[activeLayer] || [];
    const adjVals = player.adjustedAllocations[activeLayer] || [];
    // consider unsaved if arrays are empty (not submitted) AND controls have non-default values
    const blindInputs = Array.from(blindControls.querySelectorAll('input[type=range]')).map(i=>Number(i.value));
    const adjInputs = Array.from(adjustControls.querySelectorAll('input[type=range]')).map(i=>Number(i.value));
    const blindChanged = blindVals.length === 0 && blindInputs.some(v=>v !== Math.floor(100/sectors.length));
    const adjChanged = adjVals.length === 0 && adjInputs.some(v=>v !== 0);
    return blindChanged || adjChanged;
  })();
  // If other layer already has a saved draft, allow switching without forcing confirm
  const other = (activeLayer === 'operating') ? 'capital' : 'operating';
  const otherHas = (player.blindAllocations[other] && player.blindAllocations[other].length);
  if(editing && hasUnsaved && !otherHas){
    // show confirm overlay
    const overlay = document.getElementById('confirmOverlay');
    overlay.style.display = 'flex';
    document.getElementById('confirmText').textContent = 'You have unsaved changes for the current layer. Switch layers and lose changes?';
    // wire one-time handlers
    const onCancel = ()=>{ overlay.style.display='none'; document.getElementById('confirmCancel').removeEventListener('click', onCancel); document.getElementById('confirmProceed').removeEventListener('click', onProceed); };
    const onProceed = ()=>{ overlay.style.display='none'; document.getElementById('confirmCancel').removeEventListener('click', onCancel); document.getElementById('confirmProceed').removeEventListener('click', onProceed); actuallySetLayer(layer); };
    document.getElementById('confirmCancel').addEventListener('click', onCancel);
    document.getElementById('confirmProceed').addEventListener('click', onProceed);
    return;
  }
  actuallySetLayer(layer);
}

function actuallySetLayer(layer){
  activeLayer = layer;
  try{ updateTotalFundsDisplay(); }catch(e){}
  try{ localStorage.setItem('activeLayer', activeLayer); }catch(e){}
  // refresh UI that depends on layer
  refreshLayerUI();
  // update blind mode label and pie if visible
  try{ if(typeof updateBlindLayerLabel === 'function') updateBlindLayerLabel(); }catch(e){}
  try{
    // if pie mode visible, re-init the pie with data for the new layer
  if(typeof blindModePieEl !== 'undefined' && blindModePieEl && blindModePieEl.style && blindModePieEl.style.display !== 'none'){
      initBlindPie();
    } else {
      // otherwise update sliders to reflect the current layer
      const vals = player.blindAllocations[activeLayer] || [];
      if(vals.length){ blindControls.querySelectorAll('input[type=range]').forEach((el,i)=>{ el.value = vals[i]; document.getElementById('blindVal'+i).textContent = (vals[i]||0) + '%'; }); }
    }
  }catch(e){ /* non-fatal UI sync error */ }
  // update header toggle buttons active state
  try{
    const tOp = document.getElementById('toggleOperating');
    const tCap = document.getElementById('toggleCapital');
    if(tOp) tOp.classList.toggle('active', activeLayer === 'operating');
    if(tCap) tCap.classList.toggle('active', activeLayer === 'capital');
  }catch(e){}
}

function refreshLayerUI(){
  // update revenue chart if visible
  try{ if(document.getElementById('scene-revenue').classList.contains('active')) initRevenueChart(); }catch(e){}
  // update adjust controls city labels
  adjustControls.querySelectorAll('.slider-row').forEach((row, i)=>{
    const cityLabel = row.querySelector('div[style*="City:"]');
    if(cityLabel) cityLabel.textContent = `City: ${ (sectors[i].city && sectors[i].city[activeLayer]) ? sectors[i].city[activeLayer] : 0 }%`;
  });
  // update blind/adjust sliders values to show player values for the current layer if present
  const blindVals = player.blindAllocations[activeLayer] || [];
  const adjVals = player.adjustedAllocations[activeLayer] || [];
  blindControls.querySelectorAll('input[type=range]').forEach((el,i)=>{ el.value = (blindVals[i] != null) ? blindVals[i] : el.value; document.getElementById('blindVal'+i).textContent = el.value + '%'; });
  adjustControls.querySelectorAll('input[type=range]').forEach((el,i)=>{ el.value = (adjVals[i] != null) ? adjVals[i] : el.value; document.getElementById('adjVal'+i).textContent = el.value + '%'; });
}

// --- Compare view: toggle and combined stacked mode
const compareViewToggle = document.getElementById('compareViewToggle');
const compareLayerLabel = document.getElementById('compareLayerLabel');
let compareMode = localStorage.getItem('compareMode') || 'operating';
// wire compare toggle buttons
if(compareViewToggle){
  compareViewToggle.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      compareViewToggle.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      compareMode = btn.getAttribute('data-view');
      try{ localStorage.setItem('compareMode', compareMode); }catch(e){}
      updateCompareView();
    });
  });
}

function updateCompareView(){
  compareLayerLabel.textContent = compareMode === 'combined' ? 'combined' : activeLayer;
  // if combined, render a stacked bar with two datasets (operating and capital city values)
  if(compareMode === 'combined'){
    // create stacked bar: datasets are Operating (city), Capital (city), plus blind & adjusted stacks per player
    const cityOp = sectors.map(s => (s.city && s.city.operating) ? s.city.operating : 0);
    const cityCap = sectors.map(s => (s.city && s.city.capital) ? s.city.capital : 0);
    // Blind and adjusted we show as single series each (percent) but they don't stack with city; we'll show them side-by-side grouped
    compareChart.config.type = 'bar';
    compareChart.options = {
      responsive:true,
      plugins: { legend: { position: 'bottom' } },
      scales: { x: { stacked: false }, y: { beginAtZero:true, max:100 } }
    };
    compareChart.data = { labels: sectors.map(s=>s.name), datasets: [
      { label: 'City - Operating (%)', backgroundColor: 'rgba(96,96,96,0.7)', data: cityOp },
      { label: 'City - Capital (%)', backgroundColor: 'rgba(60,60,100,0.65)', data: cityCap },
      { label: 'Blind (%)', backgroundColor: 'rgba(200,30,45,0.9)', data: player.blindAllocations.operating || new Array(sectors.length).fill(0) },
      { label: 'Adjusted (%)', backgroundColor: 'rgba(20,115,220,0.9)', data: player.adjustedAllocations.operating || new Array(sectors.length).fill(0) }
    ] };
    compareChart.update();
    renderComparison();
    return;
  }
  // otherwise, show per-layer grouped bars (Blind / Adjust / City) for the selected layer
  compareMode = (compareMode === 'operating' || compareMode === 'capital') ? compareMode : activeLayer;
  compareChart.config.type = 'bar';
  compareChart.options = { responsive:true, plugins:{ legend:{ position:'bottom', labels:{ color: 'rgba(255,255,255,0.92)' } } }, scales:{ y:{ beginAtZero:true, max:100, ticks:{ color: 'rgba(255,255,255,0.9)' } }, x:{ ticks:{ color: 'rgba(255,255,255,0.9)' } } } };
  // ensure datasets order matches earlier code
  const cityArr = sectors.map(s => (s.city && s.city[compareMode]) ? s.city[compareMode] : 0);
  compareChart.data = { labels: sectors.map(s=>s.name), datasets: [
    { label: 'Blind (%)', backgroundColor: 'rgba(200,30,45,0.95)', data: player.blindAllocations[compareMode] || new Array(sectors.length).fill(0) },
    { label: 'Adjusted (%)', backgroundColor: 'rgba(20,115,220,0.95)', data: player.adjustedAllocations[compareMode] || new Array(sectors.length).fill(0) },
    { label: 'Ottawa (%)', backgroundColor: 'rgba(96,96,96,0.85)', data: cityArr }
  ] };
  compareChart.update();
  renderComparison();
}

// ensure update when entering compare scene
document.getElementById('scene-compare').addEventListener('transitionstart', ()=>{});
document.getElementById('scene-compare').addEventListener('transitionend', ()=>{ updateCompareView(); });

// initialize compare view selection will run after compareChart is created

/* Revenue scene: interactive pie chart (hover, click to focus, keyboard) */
// Data (totals in millions)
// Operating / revenue total (example, in millions)
const TOTAL_REV = 5050; // operating / revenue total in M
// Capital total derived from the Capital CSV (2025 column). Value is in thousands in CSV; converted to M here.
const TOTAL_CAPITAL = 1471.282; // ~1,471.282 M (1.471B)

function getLayerTotalM(layer){ return (layer === 'capital') ? TOTAL_CAPITAL : TOTAL_REV; }

function updateTotalFundsDisplay(){ try{ const tf = document.getElementById('totalFunds'); if(tf) tf.textContent = `$${getLayerTotalM(activeLayer)}M`; }catch(e){} }
// revenueMeta derives from sectors; percentages are read from sectors[*].city[activeLayer]
const revenueMeta = sectors.map(s => ({ key: s.name, icon: s.icon, explain: `${s.name} — city share` }));

// revenue UI elements
const revName = document.getElementById('revName');
const revPct = document.getElementById('revPct');
const revExpl = document.getElementById('revExplainer');

// populate total funds display in left panel (human-readable)
updateTotalFundsDisplay();

// clicking the left debrief panel shows debrief and updates advisor text
try{
  const dp = document.getElementById('debriefPanel');
  if(dp) dp.addEventListener('click', ()=>{ showScene('debrief'); updateAdvisorForScene('debrief'); });
}catch(e){}

// populate debrief description with current totals
try{ const dd = document.getElementById('debriefDesc'); if(dd) dd.textContent = `You have $${getLayerTotalM(activeLayer)}M in revenue to allocate across services. Use the controls to distribute 100% across sectors.`; }catch(e){}

// populate inline debrief total used in debrief scene copy
try{ const di = document.getElementById('debriefTotalInline'); if(di) di.textContent = `$${getLayerTotalM(activeLayer)}M`; }catch(e){}

const revColors = [
  // accessible distinct palette (red, orange, blue, green, purple, yellow)
  'rgba(200,30,45,0.98)',
  'rgba(245,130,32,0.98)',
  'rgba(20,115,220,0.98)',
  'rgba(40,160,80,0.98)',
  'rgba(120,80,160,0.98)',
  'rgba(245,200,55,0.98)'
];
const revColorsHover = revColors.map(c => c.replace(/0\.98|0\.85/g, '1'));

const revCtx = document.getElementById('revenueChart');

// ==== Chart.js safe defaults (light labels on dark UI) ====
if (window.Chart) {
  Chart.defaults.color = Chart.defaults.color || '#f5f7fb';
  Chart.defaults.font = Chart.defaults.font || {};
  Chart.defaults.font.family = Chart.defaults.font.family || "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial";
}

// Keep singletons so we can destroy safely before re-creating
let revenueChart = null;
let compareChart = null;
// blindPie declared later where used

function destroyIfExists(canvasId){
  const el = document.getElementById(canvasId);
  if (!el) return null;
  try{ const inst = Chart.getChart(el); if(inst) { inst.destroy(); } }catch(e){}
  return el;
}

function initRevenueChart(){
  // destroy existing chart if any
  const canvas = destroyIfExists('revenueChart');
  if(!canvas) return;
  const labels = sectors.map(s => s.name);
  const data = sectors.map(s => Number((s.city && s.city[activeLayer]) ? s.city[activeLayer] : 0));
  const safeColors = [ '#ff6b72','#f6b04e','#5ab1ff','#62d288','#b9b9c7','#ff8ad1','#89d2ff','#ffd86b' ];
  try{
    revenueChart = new Chart(canvas, {
      type: 'pie',
      data: { labels, datasets:[{ data, backgroundColor: safeColors.slice(0, data.length), borderColor:'#fff', borderWidth:1 }] },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins: {
          legend: { position:'bottom', labels:{ color:'#f5f7fb' } },
          tooltip: { backgroundColor:'#fff', titleColor:'#111', bodyColor:'#111', callbacks:{ label: (ctx)=> ` ${ctx.parsed}%` } }
        },
        onHover: (e, els) => { if(e && e.native && e.native.target) e.native.target.style.cursor = els.length ? 'pointer' : 'default'; }
      }
    });
    attachRevenueHandlers(); revenueFocus(0);
  }catch(err){ console.error('initRevenueChart error', err); const dd = document.getElementById('revDetails'); if(dd) dd.innerHTML = '<strong>Revenue data</strong><ul>'+ sectors.map(s=>`<li>${s.name}: ${ (s.city && s.city[activeLayer]) ? s.city[activeLayer] : 0 }%</li>`).join('') +'</ul>'; }
}

let revenueFocused = null;
function revenueFocus(i){
  // set focused index; the dataset's scriptable `offset` will read this on update
  revenueFocused = (i === null) ? null : i;
  if(i !== null && i >= 0){
    const s = sectors[i];
    const pct = (s.city && s.city[activeLayer]) ? s.city[activeLayer] : 0;
  const dollars = Math.round((pct/100)*getLayerTotalM(activeLayer));
    revName.textContent = `${s.icon} ${s.name}`;
    revPct.textContent = `${pct}%  (~$${dollars}M)`;
    revExpl.textContent = s.name + ' — city share (layer: ' + activeLayer + ')';
  } else {
    revName.textContent = 'Where Ottawa\'s Money Comes From';
    revPct.textContent = '';
    revExpl.textContent = 'Click a slice to see what this pays for, who pays it, and why it matters.';
  }
  // Use a non-animated update to avoid jerky growth (Chart.js will still animate if you want)
  try{ if(revenueChart) revenueChart.update(); }catch(e){ console.error('Error updating revenueChart', e); }
}

// click handler
// attach handlers to the canvas dynamically (canvas may be re-used)
function attachRevenueHandlers(){
  const canvas = document.getElementById('revenueChart');
  if(!canvas) return;
  canvas.addEventListener('click', (evt)=>{
    if(!revenueChart) return;
    const pts = revenueChart.getElementsAtEventForMode(evt, 'nearest', {intersect:true}, false);
    if(!pts.length){ revenueFocus(null); return; }
    const i = pts[0].index;
    revenueFocus(revenueFocused === i ? null : i);
  });
  canvas.setAttribute('tabindex','0');
  canvas.addEventListener('keydown', (e)=>{
  if(document.activeElement !== canvas) return;
  if(!revenueChart) return;
  const max = sectors.length - 1;
    if(e.key === 'Escape'){ revenueFocus(null); e.preventDefault(); return; }
    if(e.key === 'ArrowRight' || e.key === 'ArrowDown'){ const next = revenueFocused === null ? 0 : Math.min(max, revenueFocused+1); revenueFocus(next); e.preventDefault(); }
    if(e.key === 'ArrowLeft' || e.key === 'ArrowUp'){ const prev = revenueFocused === null ? 0 : Math.max(0, revenueFocused-1); revenueFocus(prev); e.preventDefault(); }
    if(e.key === 'Enter' && revenueFocused === null){ revenueFocus(0); e.preventDefault(); }
  });
}

// call attachRevenueHandlers once at load — it will attach to the existing canvas
attachRevenueHandlers();

// keyboard
revCtx.setAttribute('tabindex','0');
revCtx.addEventListener('keydown', (e)=>{
  // only handle when canvas has focus
  if(document.activeElement !== revCtx) return;
  const max = sectors.length - 1;
  if(e.key === 'Escape'){ revenueFocus(null); e.preventDefault(); return; }
  if(e.key === 'ArrowRight' || e.key === 'ArrowDown'){ const next = revenueFocused === null ? 0 : Math.min(max, revenueFocused+1); revenueFocus(next); e.preventDefault(); }
  if(e.key === 'ArrowLeft' || e.key === 'ArrowUp'){ const prev = revenueFocused === null ? 0 : Math.max(0, revenueFocused-1); revenueFocus(prev); e.preventDefault(); }
  if(e.key === 'Enter' && revenueFocused === null){ revenueFocus(0); e.preventDefault(); }
});

document.getElementById('revenueContinue').addEventListener('click', () => {
  showScene('blind');
});

// init revenue focus
revenueFocus(0);

// Defensive: prevent horizontal wheel/touch panning from scrolling the page when revenue scene is active
function preventHorizontalScroll(e){
  if(!document.getElementById('scene-revenue')) return;
  if(document.getElementById('scene-revenue').classList.contains('active')){
    // if wheel has horizontal delta larger than vertical, prevent
    if(Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault();
  }
}
window.addEventListener('wheel', preventHorizontalScroll, { passive: false });

// touch move prevention for mobile horizontal swipes
window.addEventListener('touchmove', (e)=>{
  if(document.getElementById('scene-revenue').classList.contains('active')){
    // If touch is horizontal, prevent default to avoid page pan
    // Basic heuristic: compare first touch movement
    // (we keep it simple; modern browsers prefer passive listeners so this is best-effort)
    // No-op here; most browsers will not allow passive false on touchmove without gestures handling.
  }
}, { passive: true });

// Force chart resize on window resize to keep it contained
window.addEventListener('resize', ()=>{ try{ revenueChart.resize(); }catch(e){} });
// Ensure revenueContinue always advances even if chart failed
const revContinueBtn = document.getElementById('revenueContinue');
if(revContinueBtn){ revContinueBtn.addEventListener('click', () => { showScene('blind'); }); }

// --- Build blind controls (icons only labels)
const blindControls = document.getElementById('blindControls');
sectors.forEach((s, i) => {
  const row = document.createElement('div'); row.className = 'slider-row';
  row.innerHTML = `
    <div class="icon">${s.icon}</div>
    <input type="range" min="0" max="100" step="1" value="${Math.floor(100/sectors.length)}" data-idx="${i}" />
    <div style="width:60px; text-align:right" class="muted" id="blindVal${i}">${Math.floor(100/sectors.length)}%</div>
  `;
  blindControls.appendChild(row);
  // ensure the input has an event listener
  const inp = row.querySelector('input');
  if(inp){ inp.addEventListener('input', (ev)=>{ console.debug('blind input', i, ev.target.value); updateBlindTotals(); }); }
});

// Header brand click: reliably start app / go to debrief
try{ const brand = document.querySelector('.brand'); if(brand) brand.addEventListener('click', ()=>{ showScene('debrief'); }); }catch(e){}

// Helper: randomize an allocation array (sum to 100)
function randomAllocation(n){ const arr = []; for(let i=0;i<n;i++) arr[i] = Math.random(); const s = arr.reduce((a,b)=>a+b,0); return arr.map(v=> Math.max(0, Math.round((v/s)*100))); }

// Attach Randomize buttons behaviour (blind and adjust)
try{
  const br = document.getElementById('blindRandom');
  if(br){ br.addEventListener('click', ()=>{
    const vals = randomAllocation(sectors.length);
    setBlindValues(vals);
    updateBlindTotals();
    showToast('Randomized blind allocations');
  });
}
}catch(e){console.warn('blind randomize wiring failed', e)}

try{
  const ar = document.getElementById('adjustRandom');
  if(ar){ ar.addEventListener('click', ()=>{
    const vals = randomAllocation(sectors.length);
    adjustControls.querySelectorAll('input[type=range]').forEach((el,i)=>{ el.value = vals[i]; document.getElementById('adjVal'+i).textContent = vals[i] + '%'; });
    updateAdjustTotals();
    showToast('Randomized adjusted allocations');
  });
}
}catch(e){console.warn('adjust randomize wiring failed', e)}

// --- Advanced Blind: presets + pie drag interaction (Approach A)
const modePresetsBtn = document.getElementById('modePresets');
const modePieBtn = document.getElementById('modePie');
const modeSlidersBtn = document.getElementById('modeSliders');
const blindModePresetsEl = document.getElementById('blindModePresets');
const blindModePieEl = document.getElementById('blindModePie');
const blindModeSlidersEl = document.getElementById('blindModeSliders');
const blindLayerLabel = document.getElementById('blindLayerLabel');
const presetButtonsContainer = document.getElementById('presetButtons');

// Preset definitions (percent arrays that sum to 100)
const presets = {
  'Equal': new Array(sectors.length).fill(Math.floor(100/sectors.length)).map((v,i,arr)=> i===0? v + (100 - v*arr.length) : v),
  'Transit Priority': sectors.map(s=> s.name === 'Transit' ? 40 : Math.floor((60)/(sectors.length-1)) ),
  'Housing Priority': sectors.map(s=> s.name === 'Housing' ? 40 : Math.floor((60)/(sectors.length-1)) ),
  'City Mix': (layer => sectors.map(s => (s.city && s.city[layer]) ? s.city[layer] : 0)),
  'Random': (()=>{ const arr = []; for(let i=0;i<sectors.length;i++) arr[i]=Math.random(); const sum = arr.reduce((a,b)=>a+b,0); return arr.map(v=> Math.round((v/sum)*100)); })()
};

// create preset buttons
Object.keys(presets).forEach(key=>{
  const b = document.createElement('button'); b.className='preset-btn'; b.textContent = key; presetButtonsContainer.appendChild(b);
  b.addEventListener('click', ()=>{
    // compute values (presets['City Mix'] is function)
    let vals = typeof presets[key] === 'function' ? presets[key](activeLayer) : presets[key];
    // normalize rounding to sum 100
    const s = vals.reduce((a,b)=>a+b,0); if(s!==100){ const diff = 100 - s; vals[0] = vals[0] + diff; }
    setBlindValues(vals);
    // mark active
    presetButtonsContainer.querySelectorAll('button').forEach(bb=>bb.classList.remove('active')); b.classList.add('active');
  });
});

// Blind pie Chart
const blindPieCtx = document.getElementById('blindPie');
const blindPieOverlayEl = document.getElementById('blindPieOverlay');
let blindPie = null;
let pieDrag = { active:false, startAngle:0, startValues:[], index:0 };

function initBlindPie(){
  const initial = (player.blindAllocations[activeLayer] && player.blindAllocations[activeLayer].length) ? player.blindAllocations[activeLayer].slice() : new Array(sectors.length).fill(Math.floor(100/sectors.length));
  // normalize to 100
  const sum = initial.reduce((a,b)=>a+b,0); if(sum !== 100){ const diff = 100 - sum; initial[0] = initial[0] + diff; }
  if(blindPie){ blindPie.destroy(); blindPie = null; }
  // also ensure no other Chart is attached to this canvas
  try{ const existing = Chart.getChart(blindPieCtx); if(existing) { existing.destroy(); } }catch(e){}

  blindPie = new Chart(blindPieCtx, {
    type: 'pie',
    data: { labels: sectors.map(s=>s.name), datasets: [{ data: initial, backgroundColor: revColors.slice(0,sectors.length), hoverOffset:8 }] },
    options: { responsive:true, plugins:{ legend:{ position:'bottom', labels: { color: 'rgba(255,255,255,0.92)' } }, tooltip: { bodyColor: 'rgba(255,255,255,0.95)', titleColor: 'rgba(255,255,255,0.98)' } }, animation:{ duration:0 }, maintainAspectRatio:false }
  });
  // attach pointer handlers to overlay (improves hit testing on touch / when canvas is visually styled)
  if(blindPieOverlayEl){
    blindPieOverlayEl.style.touchAction = 'none';
    // when user intentionally interacts, enable keyboard focus for accessibility
    blindPieOverlayEl.addEventListener('pointerdown', (ev)=>{
      try{ if(!blindPieOverlayEl.hasAttribute('tabindex')) blindPieOverlayEl.setAttribute('tabindex','0'); blindPieOverlayEl.focus(); }catch(e){}
      onPiePointerDown(ev);
    });
    // use capture on window for moves/up so drag continues even if pointer leaves overlay
    window.addEventListener('pointermove', onPiePointerMove);
    window.addEventListener('pointerup', onPiePointerUp);
    // keyboard support: set tabindex dynamically so it won't capture focus until user interacts
    blindPieOverlayEl.removeAttribute('tabindex');
    blindPieOverlayEl.addEventListener('keydown', (e)=>{
      if(document.activeElement !== blindPieOverlayEl) return;
      const focused = pieDrag.index != null ? pieDrag.index : 0;
      if(e.key === '+' || e.key === '=' || e.key === 'ArrowUp') { adjustSliceBy(focused, 1); e.preventDefault(); }
      if(e.key === '-' || e.key === '_' || e.key === 'ArrowDown') { adjustSliceBy(focused, -1); e.preventDefault(); }
    });
  } else {
    // fallback to canvas events if overlay not present
    blindPieCtx.style.touchAction = 'none';
    blindPieCtx.addEventListener('pointerdown', onPiePointerDown);
    window.addEventListener('pointermove', onPiePointerMove);
    window.addEventListener('pointerup', onPiePointerUp);
    // leave keyboard handlers on canvas in fallback
    blindPieCtx.setAttribute('tabindex','0');
    blindPieCtx.addEventListener('keydown', (e)=>{
      if(document.activeElement !== blindPieCtx) return;
      const focused = pieDrag.index != null ? pieDrag.index : 0;
      if(e.key === '+' || e.key === '=' || e.key === 'ArrowUp') { adjustSliceBy(focused, 1); e.preventDefault(); }
      if(e.key === '-' || e.key === '_' || e.key === 'ArrowDown') { adjustSliceBy(focused, -1); e.preventDefault(); }
    });
  }
  // visual class
  blindPieCtx.parentElement && blindPieCtx.parentElement.classList.remove('pie-dragging');
  updateBlindUIFromPie();
}

// --- Helper functions for blind UI (were missing, re-added)
function readBlindValues(){
  // prefer pie data when pie mode is visible
  try{
    if(blindModePieEl && blindModePieEl.style && blindModePieEl.style.display !== 'none' && blindPie){
      return blindPie.data.datasets[0].data.map(Number);
    }
  }catch(e){}
  const values = [];
  blindControls.querySelectorAll('input[type=range]').forEach((el,i)=> values[i] = Number(el.value));
  return values;
}

function updateBlindUIFromPie(){
  if(!blindPie) return;
  const vals = blindPie.data.datasets[0].data.map(v=> Number(v));
  // update sliders if present
  blindControls.querySelectorAll('input[type=range]').forEach((el,i)=>{ el.value = vals[i]; try{ document.getElementById('blindVal'+i).textContent = vals[i] + '%'; }catch(e){} });
  if(blindTotalEl) blindTotalEl.textContent = `Total: ${vals.reduce((a,b)=>a+b,0)} / ${BUDGET}`;
  const b = document.getElementById('blindSubmit'); if(b) b.disabled = (Math.round(vals.reduce((a,b)=>a+b,0)) !== 100);
}

function setBlindValues(vals){
  // normalize to 100
  const s = vals.reduce((a,b)=>a+b,0);
  if(s !== 100){ const diff = 100 - s; vals[0] = (vals[0]||0) + diff; }
  if(blindPie){ try{ blindPie.data.datasets[0].data = vals.slice(); blindPie.update('none'); }catch(e){} }
  // update sliders too
  blindControls.querySelectorAll('input[type=range]').forEach((el,i)=>{ el.value = vals[i]; try{ document.getElementById('blindVal'+i).textContent = vals[i] + '%'; }catch(e){} });
  if(blindTotalEl) blindTotalEl.textContent = `Total: ${vals.reduce((a,b)=>a+b,0)} / ${BUDGET}`;
}

function getPointerAngle(evt, canvas){
  const r = canvas.getBoundingClientRect();
  const x = evt.clientX - r.left; const y = evt.clientY - r.top;
  const cx = r.width/2; const cy = r.height/2;
  let a = Math.atan2(y - cy, x - cx); // -PI .. PI
  // convert to 0..2PI with Chart starting angle -PI/2 offset
  a = a < -Math.PI ? a + 2*Math.PI : a;
  return (a + Math.PI*1.5) % (2*Math.PI); // align with Chart.js default start angle (-90deg)
}

// Given an angle (rad) return the nearest slice index and whether the pointer is near the slice's leading edge
function angleToIndexAndEdge(angle, values){
  const total = values.reduce((a,b)=>a+b,0);
  const angles = values.map(v => (v/total) * 2*Math.PI);
  let acc = 0;
  for(let i=0;i<angles.length;i++){
    const start = acc; const end = acc + angles[i];
    // normalize angle into [start,end]
    if(angle >= start && angle <= end){
      const distToStart = Math.abs(angle - start);
      const distToEnd = Math.abs(end - angle);
      const edge = distToStart < distToEnd ? 'start' : 'end';
      return { index: i, edge, start, end };
    }
    acc = end;
  }
  // fallback
  return { index: values.length-1, edge: 'end', start:0, end:2*Math.PI };
}

function onPiePointerDown(e){
  if(!blindPie) return;
  pieDrag.active = true;
  pieDrag.startAngle = getPointerAngle(e, blindPieCtx);
  pieDrag.startValues = blindPie.data.datasets[0].data.slice();
  const ai = angleToIndexAndEdge(pieDrag.startAngle, pieDrag.startValues);
  pieDrag.index = ai.index;
  pieDrag.edgeInfo = ai; // {index, edge:'start'|'end'}
  // capture on overlay when available to ensure moves/up are tracked
  try{ if(blindPieOverlayEl && blindPieOverlayEl.setPointerCapture) blindPieOverlayEl.setPointerCapture(e.pointerId); else if(blindPieCtx && blindPieCtx.setPointerCapture) blindPieCtx.setPointerCapture(e.pointerId); }catch(ex){}
  // add visual highlight
  blindPieCtx.parentElement && blindPieCtx.parentElement.classList.add('pie-dragging');
}

function onPiePointerMove(e){
  if(!pieDrag.active) return;
  const angle = getPointerAngle(e, blindPieCtx);
  let delta = angle - pieDrag.startAngle; if(delta > Math.PI) delta -= 2*Math.PI; if(delta < -Math.PI) delta += 2*Math.PI;
  const deltaPct = (delta / (2*Math.PI)) * 100;
  const idx = pieDrag.index; const startVals = pieDrag.startValues.slice();
  const newVals = startVals.slice();
  // determine which boundary is being moved
  if(pieDrag.edgeInfo && pieDrag.edgeInfo.edge === 'end'){
    const nextIdx = (idx + 1) % startVals.length;
    let change = Math.round(deltaPct);
    newVals[idx] = Math.max(0, Math.min(100, startVals[idx] + change));
    newVals[nextIdx] = Math.max(0, Math.min(100, startVals[nextIdx] - change));
  } else {
    // moving start edge -> adjust previous slice (idx-1) and current idx
    const prevIdx = (idx - 1 + startVals.length) % startVals.length;
    let change = Math.round(deltaPct);
    // moving start edge right increases current and decreases prev
    newVals[idx] = Math.max(0, Math.min(100, startVals[idx] + change));
    newVals[prevIdx] = Math.max(0, Math.min(100, startVals[prevIdx] - change));
  }
  // If others get negative, redistribute proportionally among remaining
  for(let i=0;i<newVals.length;i++){ if(newVals[i] < 0) newVals[i] = 0; }
  // fix rounding and sum to 100
  let s = newVals.reduce((a,b)=>a+b,0);
  if(s !== 100){ const diff = 100 - s; // apply diff to largest slice
    let maxI = 0; let maxV = -1; for(let j=0;j<newVals.length;j++){ if(newVals[j] > maxV){ maxV = newVals[j]; maxI = j; } }
    newVals[maxI] += diff;
  }
  blindPie.data.datasets[0].data = newVals.map(v=>Math.max(0, v)); blindPie.update('none'); updateBlindUIFromPie();
}

function onPiePointerUp(e){ if(!pieDrag.active) return; pieDrag.active=false; try{ if(blindPieOverlayEl && blindPieOverlayEl.releasePointerCapture) blindPieOverlayEl.releasePointerCapture(e.pointerId); else if(blindPieCtx && blindPieCtx.releasePointerCapture) blindPieCtx.releasePointerCapture(e.pointerId); }catch(ex){} }

function adjustSliceBy(idx, delta){
  if(!blindPie) return;
  const vals = blindPie.data.datasets[0].data.slice();
  const next = (idx + 1) % vals.length;
  vals[idx] = Math.max(0, Math.min(100, vals[idx] + delta));
  vals[next] = Math.max(0, Math.min(100, vals[next] - delta));
  // fix rounding
  let s = vals.reduce((a,b)=>a+b,0); if(s !== 100){ const diff = 100 - s; vals[idx] += diff; }
  blindPie.data.datasets[0].data = vals; blindPie.update('none'); updateBlindUIFromPie();
}

function updateCompareView(){
  compareLayerLabel.textContent = compareMode === 'combined' ? 'combined' : activeLayer;
  // delegate rendering to renderComparison which creates/destroys charts safely
  renderComparison();
}
sectors.forEach((s, i) => {
  const row = document.createElement('div'); row.className = 'slider-row';
  row.innerHTML = `
    <label for="adj${i}">${s.name}</label>
    <input id="adj${i}" type="range" min="0" max="100" step="1" value="0" data-idx="${i}" />
    <div style="width:60px; text-align:right" class="muted" id="adjVal${i}">0%</div>
    <div style="width:70px; text-align:right; font-size:13px; color:var(--muted);">City: ${ (s.city && s.city[activeLayer]) ? s.city[activeLayer] : 0 }%</div>
  `;
  adjustControls.appendChild(row);
});

// --- Helpers: totals and validation
function readAdjustValues(){
  const values = [];
  adjustControls.querySelectorAll('input[type=range]').forEach((el, i) => values[i] = Number(el.value));
  return values;
}

const blindTotalEl = document.getElementById('blindTotal');
const adjustTotalEl = document.getElementById('adjustTotal');

function updateBlindTotals(){
  const v = readBlindValues();
  const sum = v.reduce((a,b)=>a+b,0);
  blindTotalEl.textContent = `Total: ${sum} / ${BUDGET}`;
  const blindSubmitBtn = document.getElementById('blindSubmit');
  if(blindSubmitBtn) blindSubmitBtn.disabled = (sum !== BUDGET);
  console.debug('updateBlindTotals', sum, 'submitEnabled=', blindSubmitBtn ? !blindSubmitBtn.disabled : 'no-btn');
  blindControls.querySelectorAll('input[type=range]').forEach((el, i)=>{
    document.getElementById('blindVal'+i).textContent = el.value + '%';
  });
}

function updateAdjustTotals(){
  const v = readAdjustValues();
  const sum = v.reduce((a,b)=>a+b,0);
  adjustTotalEl.textContent = `Total: ${sum} / ${BUDGET}`;
  document.getElementById('adjustSubmit').disabled = (sum !== BUDGET);
  adjustControls.querySelectorAll('input[type=range]').forEach((el, i)=>{
    document.getElementById('adjVal'+i).textContent = el.value + '%';
  });
}

// initialize blind sliders to equal split
(function initBlind(){
  const base = Math.floor(100 / sectors.length);
  const rem = 100 - base * sectors.length;
  blindControls.querySelectorAll('input[type=range]').forEach((el,i)=>{
    el.value = base + (i < rem ? 1 : 0);
  });
  updateBlindTotals();
})();

// attach blind input handlers
// already attached per-input above; keep attaching to be safe
blindControls.querySelectorAll('input[type=range]').forEach((el)=> el.addEventListener('input', updateBlindTotals));
adjustControls.querySelectorAll('input[type=range]').forEach((el)=> el.addEventListener('input', updateAdjustTotals));

// --- Blind submit
const blindSubmitButton = document.getElementById('blindSubmit');
if(blindSubmitButton){
  blindSubmitButton.addEventListener('click', ()=>{
    const vals = readBlindValues();
    player.blindAllocations[activeLayer] = vals.slice();
    // persist
    try{ localStorage.setItem('youBlindLayers', JSON.stringify(player.blindAllocations)); }catch(e){}
    // lock blind sliders
    blindControls.querySelectorAll('input[type=range]').forEach(el => el.disabled = true);
    // prefill adjust sliders with blind values as starting point
    adjustControls.querySelectorAll('input[type=range]').forEach((el,i)=> el.value = vals[i]);
    updateAdjustTotals();
    // if the other layer hasn't been completed, switch to it and prompt user
    const other = (activeLayer === 'operating') ? 'capital' : 'operating';
    const otherHas = (player.blindAllocations[other] && player.blindAllocations[other].length);
    if(!otherHas){
  // notify and switch using inline toast
  showToast('Saved ' + activeLayer + '. Switching to ' + other + '...');
  setTimeout(()=> setActiveLayer(other), 800);
      // re-enable controls for new layer
      blindControls.querySelectorAll('input[type=range]').forEach(el=> el.disabled = false);
      // seed pie with existing if any
      initBlindPie();
      return;
    }
    // both layers done — continue to adjust
    showScene('adjust');
  });
} else { console.warn('blindSubmit button not found'); }

// Save Draft handler (persist current blind values without navigating)
const blindSaveDraftBtn = document.getElementById('blindSaveDraft');
if(blindSaveDraftBtn){
  blindSaveDraftBtn.addEventListener('click', ()=>{
    const vals = readBlindValues();
    player.blindAllocations[activeLayer] = vals.slice();
    try{ localStorage.setItem('youBlindLayers', JSON.stringify(player.blindAllocations)); }catch(e){}
    blindSaveDraftBtn.textContent = 'Saved';
    setTimeout(()=> blindSaveDraftBtn.textContent = 'Save Draft', 900);
  });
}

// --- Adjust submit
document.getElementById('adjustSubmit').addEventListener('click', ()=>{
  const vals = readAdjustValues();
  player.adjustedAllocations[activeLayer] = vals.slice();
  // lock adjust sliders
  adjustControls.querySelectorAll('input[type=range]').forEach(el => el.disabled = true);
  // save to localStorage
  try{ localStorage.setItem('youBlindLayers', JSON.stringify(player.blindAllocations)); localStorage.setItem('youAdjLayers', JSON.stringify(player.adjustedAllocations)); }catch(e){}
  renderComparison();
  showScene('compare');
});

// --- Restart
document.getElementById('restartBtn').addEventListener('click', ()=>{
  // clear state
  player.blindAllocations = [];
  player.adjustedAllocations = [];
  // reset controls
  blindControls.querySelectorAll('input[type=range]').forEach((el,i)=>{ el.disabled=false; el.value = Math.floor(100/sectors.length); document.getElementById('blindVal'+i).textContent = el.value + '%'; });
  adjustControls.querySelectorAll('input[type=range]').forEach((el,i)=>{ el.disabled=false; el.value = 0; document.getElementById('adjVal'+i).textContent = '0%'; });
  updateBlindTotals(); updateAdjustTotals();
  try{ localStorage.removeItem('youBlind'); localStorage.removeItem('youAdjusted'); }catch(e){}
  showScene('intro');
});

// Now that compareChart may be created on demand, initialize compare view UI
updateCompareView();

function renderComparison(){
  // Create/destroy compare chart safely
  const canvas = destroyIfExists('compareChart');
  if(!canvas) return;
  const labels = sectors.map(s=>s.name);
  const blind = (player.blindAllocations && player.blindAllocations[activeLayer]) ? player.blindAllocations[activeLayer].map(Number) : new Array(sectors.length).fill(0);
  const adj = (player.adjustedAllocations && player.adjustedAllocations[activeLayer]) ? player.adjustedAllocations[activeLayer].map(Number) : new Array(sectors.length).fill(0);
  const cityArr = sectors.map(s => (s.city && s.city[activeLayer]) ? s.city[activeLayer] : 0);

  // datasets vary by compareMode
  let datasets = [];
  if(compareMode === 'combined'){
    const cityOp = sectors.map(s => (s.city && s.city.operating) ? s.city.operating : 0);
    const cityCap = sectors.map(s => (s.city && s.city.capital) ? s.city.capital : 0);
    datasets = [
      { label: 'City - Operating (%)', data: cityOp, backgroundColor: 'rgba(255,255,255,0.25)' },
      { label: 'City - Capital (%)', data: cityCap, backgroundColor: 'rgba(200,200,255,0.12)' },
      { label: 'Blind (%)', data: player.blindAllocations.operating || new Array(sectors.length).fill(0), backgroundColor: '#ff6b72' },
      { label: 'Adjusted (%)', data: player.adjustedAllocations.operating || new Array(sectors.length).fill(0), backgroundColor: '#62d288' }
    ];
  } else {
    const mode = (compareMode === 'operating' || compareMode === 'capital') ? compareMode : activeLayer;
    const cityMode = sectors.map(s => (s.city && s.city[mode]) ? s.city[mode] : 0);
    datasets = [
      { label: 'City', data: cityMode, backgroundColor: 'rgba(255,255,255,0.25)' },
      { label: 'Blind', data: player.blindAllocations[mode] || new Array(sectors.length).fill(0), backgroundColor: '#ff6b72' },
      { label: 'Adjusted', data: player.adjustedAllocations[mode] || new Array(sectors.length).fill(0), backgroundColor: '#62d288' }
    ];
  }

  try{
    compareChart = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins: { legend: { labels: { color: '#f5f7fb' } }, tooltip: { backgroundColor:'#fff', titleColor:'#111', bodyColor:'#111' } },
        scales: { x: { ticks: { color: '#f5f7fb' }, grid: { color: 'rgba(255,255,255,0.08)' } }, y: { ticks: { color: '#f5f7fb' }, grid: { color: 'rgba(255,255,255,0.08)' }, beginAtZero:true, max:100 } }
      }
    });
  }catch(e){ console.error('renderComparison error', e); }

  // Numeric summary table (unchanged logic)
  const table = document.createElement('table');
  const thead = document.createElement('thead'); thead.innerHTML = '<tr><th>Sector</th><th>Blind</th><th>Adjusted</th><th>City</th></tr>'; table.appendChild(thead);
  const tbody = document.createElement('tbody');
  sectors.forEach((s,i)=>{
    const tr = document.createElement('tr');
    const cityPct = (s.city && s.city[activeLayer]) ? s.city[activeLayer] : 0;
    tr.innerHTML = `<td>${s.name}</td><td>${(blind[i]||0)}%</td><td>${(adj[i]||0)}%</td><td>${cityPct}%</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  const summary = document.getElementById('summaryTable'); summary.innerHTML=''; summary.appendChild(table);

  // Awareness & Alignment metrics
  const awareness = averageAbsoluteDifference(blind, adj);
  const alignment = Math.max(0, 100 - averageAbsoluteDifference(adj, cityArr));
  document.getElementById('awarenessVal').textContent = awareness.toFixed(1) + '%';
  document.getElementById('alignmentVal').textContent = alignment.toFixed(1) + '%';
}

function averageAbsoluteDifference(a, b){
  const n = Math.max(a.length, b.length);
  let sum = 0; for(let i=0;i<n;i++){ const ai = Number(a[i]||0); const bi = Number(b[i]||0); sum += Math.abs(ai - bi); }
  return (sum / n);
}

// Inline toast helper
function showToast(msg, ms=1200){
  const t = document.getElementById('inlineToast'); if(!t) return; t.textContent = msg; t.style.display = 'block';
  setTimeout(()=>{ t.style.display = 'none'; }, ms);
}

// --- Try restore saved state
(function tryRestore(){
  try{
    // per-layer persistence
    const savedBlindLayers = JSON.parse(localStorage.getItem('youBlindLayers')||'null');
    const savedAdjLayers = JSON.parse(localStorage.getItem('youAdjLayers')||'null');
    if(savedBlindLayers && typeof savedBlindLayers === 'object'){
      player.blindAllocations = Object.assign(player.blindAllocations, savedBlindLayers);
    }
    if(savedAdjLayers && typeof savedAdjLayers === 'object'){
      player.adjustedAllocations = Object.assign(player.adjustedAllocations, savedAdjLayers);
    }
    // populate sliders from activeLayer if values exist
  refreshLayerUI();
  // if pie exists or pie mode should be visible, initialize it to reflect saved values
  try{ if(document.getElementById('blindPie')) initBlindPie(); }catch(e){}
  // If both layers have saved arrays, optionally go to comparison — skip auto navigation for now
  if(player.blindAllocations && player.adjustedAllocations){ /* no auto-nav */ }
  }catch(e){ /* ignore */ }
})();

// Set initial scene
showScene('intro');
