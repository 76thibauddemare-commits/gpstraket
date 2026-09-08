/* ============================================================
   GPS Traket — enregistrement de tracés GPS + événements flagués
   Vanilla JS. Stockage local via IndexedDB. Carte via Leaflet.
   ============================================================ */

'use strict';

/* -------------------- IndexedDB -------------------- */
const DB_NAME = 'gpstraket';
const DB_VERSION = 1;
const STORE = 'recordings';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(rec) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* -------------------- Utilitaires -------------------- */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Distance haversine en mètres
function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function totalDistance(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
  return d;
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

/* -------------------- Génération GPX -------------------- */
function buildGPX(rec) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<gpx version="1.1" creator="GPS Traket" xmlns="http://www.topografix.com/GPX/1/1" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">'
  );

  lines.push('  <metadata>');
  lines.push(`    <name>${escapeXml(rec.name)}</name>`);
  lines.push(`    <time>${new Date(rec.startedAt).toISOString()}</time>`);
  lines.push('  </metadata>');

  // Événements flagués -> waypoints
  for (const ev of rec.events) {
    lines.push(`  <wpt lat="${ev.lat}" lon="${ev.lon}">`);
    if (typeof ev.ele === 'number') lines.push(`    <ele>${ev.ele}</ele>`);
    lines.push(`    <time>${new Date(ev.time).toISOString()}</time>`);
    lines.push(`    <name>${escapeXml(ev.name || 'Événement')}</name>`);
    lines.push(`    <desc>${escapeXml('Événement signalé le ' + fmtDate(ev.time))}</desc>`);
    lines.push('    <sym>Flag</sym>');
    lines.push('    <type>event</type>');
    lines.push('  </wpt>');
  }

  // Tracé -> track
  lines.push('  <trk>');
  lines.push(`    <name>${escapeXml(rec.name)}</name>`);
  lines.push('    <trkseg>');
  for (const p of rec.points) {
    lines.push(`      <trkpt lat="${p.lat}" lon="${p.lon}">`);
    if (typeof p.ele === 'number') lines.push(`        <ele>${p.ele}</ele>`);
    lines.push(`        <time>${new Date(p.time).toISOString()}</time>`);
    lines.push('      </trkpt>');
  }
  lines.push('    </trkseg>');
  lines.push('  </trk>');
  lines.push('</gpx>');
  return lines.join('\n');
}

function downloadGPX(rec) {
  const gpx = buildGPX(rec);
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const safeName = (rec.name || 'trace').replace(/[^a-z0-9-_]+/gi, '_');
  const fileName = `${safeName}.gpx`;

  // Utilise le partage natif si dispo (mobile), sinon téléchargement
  const file = new File([blob], fileName, { type: 'application/gpx+xml' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: rec.name }).catch(() => fallbackDownload(blob, fileName));
  } else {
    fallbackDownload(blob, fileName);
  }
}

function fallbackDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* -------------------- État global -------------------- */
const state = {
  recording: false,
  current: null,        // enregistrement en cours
  watchId: null,
  lastPos: null,        // dernière position connue {lat, lon, ele, accuracy, time}
  timerId: null,
  wakeLock: null,
};

/* -------------------- Éléments DOM -------------------- */
const $ = (id) => document.getElementById(id);
const el = {
  statTime: $('stat-time'),
  statDistance: $('stat-distance'),
  statPoints: $('stat-points'),
  statEvents: $('stat-events'),
  accuracy: $('accuracy-text'),
  gpsStatus: $('gps-status'),
  gpsStatusText: $('gps-status-text'),
  btnRecord: $('btn-record'),
  btnFlag: $('btn-flag'),
  flagHint: $('flag-hint'),
  toast: $('toast'),
};

/* -------------------- Navigation entre vues -------------------- */
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $('view-' + name).classList.add('active');
}

/* -------------------- Toast -------------------- */
let toastTimer = null;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2000);
}

/* -------------------- Wake Lock (garder l'écran allumé) -------------------- */
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      state.wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) { /* pas critique */ }
}
function releaseWakeLock() {
  if (state.wakeLock) { state.wakeLock.release().catch(() => {}); state.wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (state.recording && document.visibilityState === 'visible' && !state.wakeLock) {
    requestWakeLock();
  }
});

/* -------------------- Géolocalisation -------------------- */
function setGpsStatus(kind, text) {
  el.gpsStatus.className = 'gps-status ' + kind;
  el.gpsStatusText.textContent = text;
}

function onPosition(pos) {
  const c = pos.coords;
  state.lastPos = {
    lat: c.latitude,
    lon: c.longitude,
    ele: (typeof c.altitude === 'number' && !isNaN(c.altitude)) ? c.altitude : undefined,
    accuracy: c.accuracy,
    time: pos.timestamp || Date.now(),
  };
  setGpsStatus('ok', 'Signal GPS OK');
  el.accuracy.textContent = 'Précision : ±' + Math.round(c.accuracy) + ' m';

  if (state.recording && state.current) {
    const pt = {
      lat: c.latitude,
      lon: c.longitude,
      ele: state.lastPos.ele,
      time: state.lastPos.time,
    };
    // Filtre : ignore les points trop imprécis ou trop proches (bruit)
    const pts = state.current.points;
    const last = pts[pts.length - 1];
    const tooInaccurate = c.accuracy > 50 && pts.length > 0;
    const tooClose = last && haversine(last, pt) < 1.5 && (pt.time - last.time) < 5000;
    if (!tooInaccurate && !tooClose) {
      pts.push(pt);
      persistCurrentThrottled();
    }
    updateStats();
  }
}

function onPositionError(err) {
  if (err.code === err.PERMISSION_DENIED) {
    setGpsStatus('error', 'Accès au GPS refusé');
  } else if (err.code === err.TIMEOUT) {
    setGpsStatus('searching', 'Recherche du signal GPS…');
  } else {
    setGpsStatus('error', 'Erreur GPS');
  }
}

function startWatch() {
  if (state.watchId != null) return;
  if (!('geolocation' in navigator)) {
    setGpsStatus('error', 'GPS non disponible sur cet appareil');
    return;
  }
  state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15000,
  });
}

function stopWatch() {
  if (state.watchId != null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
}

/* -------------------- Sauvegarde throttlée pendant l'enregistrement -------------------- */
let persistTimer = null;
function persistCurrentThrottled() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    if (state.current) await dbPut(state.current).catch(() => {});
  }, 3000);
}

/* -------------------- Mise à jour des stats -------------------- */
function updateStats() {
  if (!state.current) return;
  const pts = state.current.points;
  el.statPoints.textContent = pts.length;
  el.statEvents.textContent = state.current.events.length;
  el.statDistance.textContent = (totalDistance(pts) / 1000).toFixed(2);
}

function tickTimer() {
  if (!state.current) return;
  el.statTime.textContent = fmtDuration(Date.now() - state.current.startedAt);
}

/* -------------------- Démarrer / arrêter l'enregistrement -------------------- */
async function startRecording() {
  const now = Date.now();
  state.current = {
    id: uid(),
    name: 'Tracé du ' + fmtDate(now),
    startedAt: now,
    endedAt: null,
    points: [],
    events: [],
  };
  state.recording = true;

  el.btnRecord.classList.add('recording');
  el.btnRecord.querySelector('.record-label').textContent = 'Arrêter';
  el.btnFlag.disabled = false;
  el.flagHint.textContent = 'Appuie sur le bouton pour signaler un problème rencontré.';

  el.statTime.textContent = '00:00:00';
  updateStats();

  startWatch();
  requestWakeLock();
  state.timerId = setInterval(tickTimer, 1000);

  await dbPut(state.current).catch(() => {});
  toast('Enregistrement démarré');
}

async function stopRecording() {
  state.recording = false;
  state.current.endedAt = Date.now();

  el.btnRecord.classList.remove('recording');
  el.btnRecord.querySelector('.record-label').textContent = 'Démarrer';
  el.btnFlag.disabled = true;
  el.flagHint.textContent = 'Démarre un enregistrement pour pouvoir signaler des événements.';

  clearInterval(state.timerId);
  state.timerId = null;
  stopWatch();
  releaseWakeLock();

  await dbPut(state.current).catch(() => {});
  const finished = state.current;
  state.current = null;

  el.statTime.textContent = '00:00:00';
  el.statDistance.textContent = '0.00';
  el.statPoints.textContent = '0';
  el.statEvents.textContent = '0';

  if (finished.points.length === 0) {
    toast('Aucun point enregistré');
  } else {
    toast('Enregistrement sauvegardé ✓');
  }
}

/* -------------------- Signaler un événement -------------------- */
async function flagEvent() {
  if (!state.recording || !state.current) return;

  const flag = (pos) => {
    const ev = {
      id: uid(),
      time: Date.now(),
      lat: pos ? pos.lat : null,
      lon: pos ? pos.lon : null,
      ele: pos ? pos.ele : undefined,
      accuracy: pos ? pos.accuracy : undefined,
      name: 'Événement ' + (state.current.events.length + 1),
    };
    state.current.events.push(ev);
    updateStats();
    dbPut(state.current).catch(() => {});

    el.btnFlag.classList.add('flashed');
    if (navigator.vibrate) navigator.vibrate(80);
    setTimeout(() => el.btnFlag.classList.remove('flashed'), 500);
    toast('🚩 Événement enregistré');
  };

  // Essaie d'obtenir une position fraîche rapidement, sinon utilise la dernière connue
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => flag({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        ele: (typeof pos.coords.altitude === 'number' && !isNaN(pos.coords.altitude)) ? pos.coords.altitude : undefined,
        accuracy: pos.coords.accuracy,
      }),
      () => flag(state.lastPos),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 4000 }
    );
  } else {
    flag(state.lastPos);
  }
}

/* -------------------- Liste des enregistrements -------------------- */
async function renderList() {
  const recs = (await dbGetAll()).sort((a, b) => b.startedAt - a.startedAt);
  const ul = $('recordings-list');
  ul.innerHTML = '';
  $('list-empty').hidden = recs.length > 0;

  for (const rec of recs) {
    const li = document.createElement('li');
    li.className = 'rec-item';
    const isLive = state.recording && state.current && state.current.id === rec.id;
    if (isLive) li.classList.add('recording-live');

    const dist = (totalDistance(rec.points) / 1000).toFixed(2);
    const dur = rec.endedAt ? fmtDuration(rec.endedAt - rec.startedAt) : fmtDuration(Date.now() - rec.startedAt);

    li.innerHTML = `
      <div class="rec-title">
        ${escapeXml(rec.name)}
        ${isLive ? '<span class="badge-live">EN COURS</span>' : ''}
      </div>
      <div class="rec-meta">
        <span>📏 ${dist} km</span>
        <span>⏱ ${dur}</span>
        <span>📍 ${rec.points.length} pts</span>
        <span>🚩 ${rec.events.length} évén.</span>
      </div>
    `;
    li.addEventListener('click', () => openMap(rec.id));
    ul.appendChild(li);
  }
}

/* -------------------- Vue carte -------------------- */
let map = null;
let mapLayers = [];
let currentMapRec = null;

function clearMapLayers() {
  for (const l of mapLayers) map.removeLayer(l);
  mapLayers = [];
}

async function openMap(id) {
  const rec = await dbGet(id);
  if (!rec) return;
  currentMapRec = rec;
  $('map-title').textContent = rec.name;

  showView('map');

  // Initialise Leaflet une seule fois
  if (!map) {
    map = L.map('map', { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
  }
  // Leaflet a besoin d'un recalcul de taille après affichage de la vue
  setTimeout(() => map.invalidateSize(), 100);

  clearMapLayers();

  const latlngs = rec.points.map((p) => [p.lat, p.lon]);

  if (latlngs.length > 0) {
    const line = L.polyline(latlngs, { color: '#38bdf8', weight: 5, opacity: 0.9 }).addTo(map);
    mapLayers.push(line);

    // Marqueurs départ / arrivée
    const start = L.circleMarker(latlngs[0], { radius: 7, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 })
      .addTo(map).bindPopup('Départ');
    const end = L.circleMarker(latlngs[latlngs.length - 1], { radius: 7, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 })
      .addTo(map).bindPopup('Arrivée');
    mapLayers.push(start, end);
  }

  // Marqueurs des événements
  for (const ev of rec.events) {
    if (ev.lat == null || ev.lon == null) continue;
    const icon = L.divIcon({
      className: '',
      html: '<div class="event-marker"><span>🚩</span></div>',
      iconSize: [26, 26],
      iconAnchor: [13, 26],
    });
    const m = L.marker([ev.lat, ev.lon], { icon })
      .addTo(map)
      .bindPopup(`<strong>${escapeXml(ev.name)}</strong><br>${fmtDate(ev.time)}`);
    mapLayers.push(m);
  }

  // Cadre la carte sur le contenu
  const allLatLngs = latlngs.concat(rec.events.filter((e) => e.lat != null).map((e) => [e.lat, e.lon]));
  if (allLatLngs.length > 0) {
    map.fitBounds(L.latLngBounds(allLatLngs), { padding: [40, 40], maxZoom: 17 });
  } else {
    map.setView([46.6, 2.4], 5); // France par défaut
  }

  // Infos
  const dist = (totalDistance(rec.points) / 1000).toFixed(2);
  const dur = rec.endedAt ? fmtDuration(rec.endedAt - rec.startedAt) : '—';
  $('map-info').innerHTML =
    `<span>📏 <strong>${dist} km</strong></span>` +
    `<span>⏱ <strong>${dur}</strong></span>` +
    `<span>📍 <strong>${rec.points.length}</strong> points</span>` +
    `<span>🚩 <strong>${rec.events.length}</strong> événements</span>` +
    `<span>🗓 ${fmtDate(rec.startedAt)}</span>`;

  $('map-actions').hidden = false;
}

/* -------------------- Événements UI -------------------- */
el.btnRecord.addEventListener('click', () => {
  if (state.recording) stopRecording();
  else startRecording();
});

el.btnFlag.addEventListener('click', flagEvent);

$('btn-goto-list').addEventListener('click', async () => {
  await renderList();
  showView('list');
});
$('btn-back-record').addEventListener('click', () => showView('record'));
$('btn-back-list').addEventListener('click', async () => {
  await renderList();
  showView('list');
});

$('btn-export-gpx').addEventListener('click', () => {
  if (currentMapRec) downloadGPX(currentMapRec);
});

$('btn-delete-rec').addEventListener('click', async () => {
  if (!currentMapRec) return;
  if (state.recording && state.current && state.current.id === currentMapRec.id) {
    toast('Arrête l\'enregistrement avant de supprimer');
    return;
  }
  if (confirm('Supprimer cet enregistrement ? Cette action est irréversible.')) {
    await dbDelete(currentMapRec.id);
    currentMapRec = null;
    await renderList();
    showView('list');
  }
});

$('btn-map-menu').addEventListener('click', () => {
  if (currentMapRec) downloadGPX(currentMapRec);
});

/* -------------------- Démarrage -------------------- */
// Lance le suivi GPS dès l'ouverture pour préchauffer le signal
window.addEventListener('load', () => {
  startWatch();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

// Avertit si on quitte pendant un enregistrement
window.addEventListener('beforeunload', (e) => {
  if (state.recording) {
    e.preventDefault();
    e.returnValue = '';
  }
});
