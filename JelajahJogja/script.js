/* ============================================================
   JelajahJogja — script.js
   Sistem Pemetaan Wisata Alternatif & Sentra Kerajinan DIY
   Author: Capstone Project Geospasial
   ============================================================ */

'use strict';

/* ──────────────────────────────────────────────
   1. KONFIGURASI APLIKASI
   ────────────────────────────────────────────── */
const CONFIG = {
  /** Koordinat pusat peta (Yogyakarta) */
  mapCenter: [-7.8, 110.37],
  /** Level zoom awal */
  mapZoom: 10,
  /** Level zoom saat flyTo destinasi tertentu */
  flyZoom: 15,
  /** Path ke file data destinasi */
  dataPath: './data/destinations.json',
  /** URL tile OpenStreetMap */
  osmTileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  /** Atribusi OpenStreetMap (wajib dicantumkan sesuai ketentuan OSM) */
  osmAttribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors | JelajahJogja',
};

/* ──────────────────────────────────────────────
   2. STATE APLIKASI
   ────────────────────────────────────────────── */
const STATE = {
  allDestinations: [],
  filteredDestinations: [],
  map: null,
  markers: {},
  activeId: null,
  filters: { search: '', category: '', region: '' },
};

/* ──────────────────────────────────────────────
   3. MODUL PETA
   ────────────────────────────────────────────── */

/**
 * Menginisialisasi peta Leaflet + tile OSM.
 * Melempar Error jika library Leaflet tidak tersedia.
 */
function initMap() {
  if (typeof L === 'undefined') {
    throw new Error('Leaflet.js belum dimuat. Periksa koneksi internet atau CDN.');
  }

  // Buat instance peta — zoomControl: false agar kita atur posisinya sendiri
  STATE.map = L.map('map', {
    center: CONFIG.mapCenter,
    zoom: CONFIG.mapZoom,
    zoomControl: false,
  });

  // Tile layer OpenStreetMap
  const tileLayer = L.tileLayer(CONFIG.osmTileUrl, {
    attribution: CONFIG.osmAttribution,
    maxZoom: 19,
    // errorTileUrl tidak digunakan agar error tetap silent di tile individual
  });
  tileLayer.addTo(STATE.map);

  // Kontrol zoom di kanan bawah agar tidak bertabrakan dengan sidebar
  L.control.zoom({ position: 'bottomright' }).addTo(STATE.map);

  // invalidateSize dipanggil dua kali dengan rAF — memastikan container
  // sudah benar-benar dirender browser sebelum Leaflet mengukur ukurannya.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (STATE.map) STATE.map.invalidateSize();
    });
  });
}

/**
 * Membuat Leaflet DivIcon dengan tampilan teardrop per kategori.
 * @param {string} category
 * @returns {L.DivIcon}
 */
function createMarkerIcon(category) {
  const isWisata = category === 'Wisata Alternatif';
  const colorClass = isWisata ? 'custom-marker--wisata' : 'custom-marker--kerajinan';

  const iconSvg = isWisata
    ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`
    : `<svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;

  return L.divIcon({
    className: '',
    html: `<div class="custom-marker ${colorClass}"><div class="custom-marker__inner">${iconSvg}</div></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -38],
  });
}

/**
 * Membuat HTML konten popup Leaflet.
 * @param {Object} dest
 * @returns {string}
 */
function createPopupContent(dest) {
  const badgeClass = dest.category === 'Wisata Alternatif'
    ? 'popup-badge--wisata'
    : 'popup-badge--kerajinan';

  return `
    <div class="popup-content">
      <span class="popup-badge ${badgeClass}">${dest.category}</span>
      <p class="popup-name">${dest.name}</p>
      <p class="popup-region">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="display:inline-block;vertical-align:middle;margin-right:3px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        ${dest.region}
      </p>
      <button class="popup-btn" onclick="openModalById('${dest.id}')">Lihat Detail</button>
    </div>`.trim();
}

/**
 * Render ulang semua marker di peta. Diabaikan bila peta belum siap.
 * @param {Array} destinations
 */
function renderMarkers(destinations) {
  if (!STATE.map) return;

  // Hapus marker lama
  Object.values(STATE.markers).forEach((m) => m.remove());
  STATE.markers = {};

  destinations.forEach((dest) => {
    if (!isValidCoordinate(dest.latitude, dest.longitude)) {
      console.warn(`Koordinat tidak valid: ${dest.name}`);
      return;
    }

    const icon = createMarkerIcon(dest.category);
    const marker = L.marker([dest.latitude, dest.longitude], { icon })
      .addTo(STATE.map)
      .bindPopup(createPopupContent(dest), {
        maxWidth: 280,
        minWidth: 220,
        closeButton: true,
        className: '',
      });

    marker.on('click', () => {
      setActiveDestination(dest.id);
      scrollCardIntoView(dest.id);
    });

    STATE.markers[dest.id] = marker;
  });
}

/**
 * Animasi pindah kamera peta ke koordinat tertentu.
 * @param {number} lat
 * @param {number} lng
 */
function flyToLocation(lat, lng) {
  if (!STATE.map) return;
  STATE.map.flyTo([lat, lng], CONFIG.flyZoom, { duration: 0.8, easeLinearity: 0.35 });
}

/**
 * Validasi koordinat WGS84 untuk wilayah DIY dan sekitarnya.
 * @param {*} lat
 * @param {*} lng
 * @returns {boolean}
 */
function isValidCoordinate(lat, lng) {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    lat >= -9 && lat <= -6 &&
    lng >= 108 && lng <= 112
  );
}

/* ──────────────────────────────────────────────
   4. MODUL DATA
   ────────────────────────────────────────────── */

/**
 * Memuat data destinasi dari JSON via Fetch API.
 */
async function loadData() {
  try {
    const response = await fetch(CONFIG.dataPath);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    STATE.allDestinations = data;
    STATE.filteredDestinations = data;

    populateRegionFilter(data);
    renderMarkers(data);
    renderCards(data);
    updateStats(data);
    hideLoading();

  } catch (error) {
    console.error('Gagal memuat data destinasi:', error);
    showLoadError();
  }
}

/**
 * Menerapkan filter search + kategori + wilayah dan memperbarui UI.
 */
function applyFilters() {
  const { search, category, region } = STATE.filters;
  const query = search.toLowerCase().trim();

  STATE.filteredDestinations = STATE.allDestinations.filter((dest) => {
    const matchSearch   = !query    || dest.name.toLowerCase().includes(query);
    const matchCategory = !category || dest.category === category;
    const matchRegion   = !region   || dest.region === region;
    return matchSearch && matchCategory && matchRegion;
  });

  renderMarkers(STATE.filteredDestinations);
  renderCards(STATE.filteredDestinations);
  updateStats(STATE.filteredDestinations);

  if (STATE.activeId && !STATE.filteredDestinations.find((d) => d.id === STATE.activeId)) {
    STATE.activeId = null;
  }
}

/**
 * Mengisi dropdown filter wilayah secara dinamis (tanpa duplikasi).
 * @param {Array} destinations
 */
function populateRegionFilter(destinations) {
  const regionSelect = document.getElementById('filterRegion');
  const regions = [...new Set(destinations.map((d) => d.region))].sort();
  regions.forEach((region) => {
    const option = document.createElement('option');
    option.value = region;
    option.textContent = region;
    regionSelect.appendChild(option);
  });
}

/* ──────────────────────────────────────────────
   5. MODUL UI
   ────────────────────────────────────────────── */

/**
 * Merender daftar kartu destinasi di sidebar.
 * @param {Array} destinations
 */
function renderCards(destinations) {
  const list    = document.getElementById('destinationList');
  const countEl = document.getElementById('listCount');

  countEl.textContent = `${destinations.length} destinasi`;

  // Hapus card lama dan empty state sebelumnya
  list.querySelectorAll('.destination-card, .list-empty').forEach((el) => el.remove());

  if (destinations.length === 0) {
    list.insertAdjacentHTML('beforeend', `
      <div class="list-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <p>Tidak ada destinasi ditemukan.<br>Coba ubah filter atau kata kunci pencarian.</p>
      </div>`);
    return;
  }

  destinations.forEach((dest) => {
    const isActive      = dest.id === STATE.activeId;
    const badgeClass    = dest.category === 'Wisata Alternatif' ? 'card__badge--wisata' : 'card__badge--kerajinan';
    const badgeLabel    = dest.category === 'Wisata Alternatif' ? 'Wisata' : 'Kerajinan';
    const verifiedClass = dest.verification_status === 'Terverifikasi' ? 'card__verification--verified' : 'card__verification--unverified';
    const verifiedIcon  = dest.verification_status === 'Terverifikasi'
      ? `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>`
      : `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>`;

    list.insertAdjacentHTML('beforeend', `
      <div class="destination-card ${isActive ? 'is-active' : ''}"
           id="card-${dest.id}" data-id="${dest.id}"
           role="listitem" tabindex="0"
           aria-label="${dest.name}, ${dest.region}">
        <div class="card__header">
          <h3 class="card__name">${dest.name}</h3>
          <span class="card__badge ${badgeClass}">${badgeLabel}</span>
        </div>
        <p class="card__region">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${dest.region}
        </p>
        <p class="card__description">${dest.description}</p>
        <span class="card__verification ${verifiedClass}">${verifiedIcon} ${dest.verification_status}</span>
      </div>`);
  });

  // Pasang event listener pada semua card baru
  list.querySelectorAll('.destination-card').forEach((card) => {
    card.addEventListener('click', () => {
      setActiveDestination(card.dataset.id);
      openModalById(card.dataset.id);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
    });
  });
}

/**
 * Stub untuk updateStats — stats chip sudah dihapus dari UI.
 * Dipertahankan agar pemanggil tidak perlu diubah.
 */
function updateStats(_destinations) {
  // Stats chip tidak ditampilkan; tidak ada operasi DOM.
}

/**
 * Menetapkan destinasi aktif: highlight card + marker, flyTo lokasi.
 * @param {string} id
 */
function setActiveDestination(id) {
  // Hapus active state sebelumnya
  const prevCard = document.getElementById(`card-${STATE.activeId}`);
  if (prevCard) prevCard.classList.remove('is-active');

  if (STATE.activeId && STATE.markers[STATE.activeId]) {
    const prevEl = STATE.markers[STATE.activeId].getElement();
    if (prevEl) prevEl.querySelector('.custom-marker')?.classList.remove('is-highlighted');
  }

  STATE.activeId = id;

  // Terapkan active state baru
  const newCard = document.getElementById(`card-${id}`);
  if (newCard) newCard.classList.add('is-active');

  if (STATE.markers[id]) {
    const el = STATE.markers[id].getElement();
    if (el) el.querySelector('.custom-marker')?.classList.add('is-highlighted');
    STATE.markers[id].openPopup();
  }

  const dest = STATE.allDestinations.find((d) => d.id === id);
  if (dest && isValidCoordinate(dest.latitude, dest.longitude)) {
    flyToLocation(dest.latitude, dest.longitude);
  }
}

/**
 * Scroll card destinasi agar terlihat di daftar sidebar.
 * @param {string} id
 */
function scrollCardIntoView(id) {
  document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Membuka modal detail berdasarkan ID destinasi.
 * Bersifat global agar bisa dipanggil dari HTML popup Leaflet.
 * @param {string} id
 */
window.openModalById = function (id) {
  const dest = STATE.allDestinations.find((d) => d.id === id);
  if (!dest) return;
  setActiveDestination(id);
  populateModal(dest);
  openModal();
};

/**
 * Mengisi semua elemen modal dengan data destinasi.
 * @param {Object} dest
 */
function populateModal(dest) {
  const catClass = dest.category === 'Wisata Alternatif' ? 'modal-badge--wisata' : 'modal-badge--kerajinan';
  const verClass = dest.verification_status === 'Terverifikasi' ? 'modal-badge--verified' : 'modal-badge--unverified';

  document.getElementById('modalBadges').innerHTML = `
    <span class="modal-badge ${catClass}">${dest.category}</span>
    <span class="modal-badge ${verClass}">${dest.verification_status}</span>`;

  document.getElementById('modalName').textContent = dest.name;
  document.getElementById('modalRegion').innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
    ${dest.region}`;

  document.getElementById('modalAddress').textContent  = dest.address   || 'Alamat belum tersedia.';
  document.getElementById('modalCoords').textContent   = isValidCoordinate(dest.latitude, dest.longitude)
    ? `${dest.latitude}, ${dest.longitude}` : 'Koordinat tidak tersedia.';
  document.getElementById('modalDescription').textContent = dest.description || 'Deskripsi belum tersedia.';

  // Helper: tampilkan/sembunyikan section tag list
  function renderTags(sectionId, listId, items) {
    const section = document.getElementById(sectionId);
    const list    = document.getElementById(listId);
    if (items && items.length > 0) {
      list.innerHTML = items.map((i) => `<li>${i}</li>`).join('');
      section.style.display = '';
    } else {
      section.style.display = 'none';
    }
  }
  renderTags('modalCraftsSection',     'modalCrafts',     dest.crafts);
  renderTags('modalActivitiesSection', 'modalActivities', dest.educational_activities);
  renderTags('modalFacilitiesSection', 'modalFacilities', dest.facilities);

  // Jam operasional
  const hoursRow = document.getElementById('modalHoursRow');
  if (dest.operating_hours) {
    document.getElementById('modalHours').textContent = dest.operating_hours;
    hoursRow.style.display = '';
  } else {
    hoursRow.style.display = 'none';
  }

  // Kontak
  const contactRow = document.getElementById('modalContactRow');
  if (dest.contact) {
    document.getElementById('modalContact').textContent = dest.contact;
    contactRow.style.display = '';
  } else {
    contactRow.style.display = 'none';
  }

  // Sumber & verifikasi
  document.getElementById('modalSource').textContent = dest.source || 'Tidak diketahui';
  const verEl = document.getElementById('modalVerification');
  verEl.textContent = dest.verification_status;
  verEl.className = `modal__verification ${
    dest.verification_status === 'Terverifikasi' ? 'modal__verification--verified' : 'modal__verification--unverified'
  }`;

  // Tombol Google Maps Direction
  const dirBtn = document.getElementById('modalDirections');
  if (isValidCoordinate(dest.latitude, dest.longitude)) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${dest.latitude},${dest.longitude}`;
    dirBtn.onclick  = () => window.open(url, '_blank', 'noopener,noreferrer');
    dirBtn.disabled = false;
  } else {
    dirBtn.onclick  = null;
    dirBtn.disabled = true;
  }
}

/** Tampilkan overlay modal. */
function openModal() {
  const overlay = document.getElementById('modalOverlay');
  overlay.removeAttribute('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('modalClose').focus(), 50);
}

/** Tutup overlay modal. */
function closeModal() {
  document.getElementById('modalOverlay').setAttribute('hidden', '');
  document.body.style.overflow = '';
}

/** Sembunyikan spinner loading. */
function hideLoading() {
  document.getElementById('listLoading')?.remove();
}

/** Tampilkan pesan error di sidebar. */
function showLoadError() {
  const list = document.getElementById('destinationList');
  hideLoading();
  list.innerHTML = `
    <div class="list-empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <p><strong>Gagal memuat data.</strong><br>Pastikan menggunakan Live Server. File JSON tidak dapat dibuka via <code>file://</code>.</p>
    </div>`;
}

/* ──────────────────────────────────────────────
   6. MODUL EVENT
   ────────────────────────────────────────────── */

function bindEvents() {
  const searchInput = document.getElementById('searchInput');
  const searchClear = document.getElementById('searchClear');

  searchInput.addEventListener('input', (e) => {
    STATE.filters.search = e.target.value;
    searchClear.hidden = !e.target.value;
    applyFilters();
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.hidden = true;
    STATE.filters.search = '';
    applyFilters();
    searchInput.focus();
  });

  document.getElementById('filterCategory').addEventListener('change', (e) => {
    STATE.filters.category = e.target.value;
    applyFilters();
  });

  document.getElementById('filterRegion').addEventListener('change', (e) => {
    STATE.filters.region = e.target.value;
    applyFilters();
  });

  document.getElementById('resetFilter').addEventListener('click', () => {
    STATE.filters = { search: '', category: '', region: '' };
    document.getElementById('searchInput').value     = '';
    document.getElementById('filterCategory').value  = '';
    document.getElementById('filterRegion').value    = '';
    document.getElementById('searchClear').hidden    = true;
    applyFilters();
  });

  document.getElementById('modalClose').addEventListener('click', closeModal);

  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('modalOverlay').hasAttribute('hidden')) {
      closeModal();
    }
  });

  // Mobile sidebar toggle
  const menuToggle = document.getElementById('menuToggle');
  const sidebar    = document.getElementById('sidebar');

  menuToggle.addEventListener('click', () => {
    const isOpen = sidebar.classList.toggle('is-open');
    menuToggle.classList.toggle('is-active', isOpen);
    menuToggle.setAttribute('aria-expanded', String(isOpen));
  });

  document.getElementById('map').addEventListener('click', () => {
    if (window.innerWidth <= 768 && sidebar.classList.contains('is-open')) {
      sidebar.classList.remove('is-open');
      menuToggle.classList.remove('is-active');
      menuToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

/* ──────────────────────────────────────────────
   7. ENTRY POINT
   ────────────────────────────────────────────── */

function init() {
  // Inisialisasi peta — dibungkus try/catch agar kegagalan CDN
  // tidak menghentikan data loading dan interaksi sidebar.
  try {
    initMap();
  } catch (err) {
    console.error('Inisialisasi peta gagal:', err.message);
    const mapEl = document.getElementById('map');
    if (mapEl) {
      mapEl.style.cssText = 'display:flex;align-items:center;justify-content:center;background:#EEF2FF;';
      mapEl.innerHTML = `
        <div style="text-align:center;padding:32px;max-width:320px;font-family:inherit">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#93C5FD" stroke-width="1.5" stroke-linecap="round" style="margin-bottom:14px"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          <p style="font-size:0.92rem;color:#6B7280;margin:0 0 14px">Peta tidak dapat dimuat.<br>Periksa koneksi internet Anda.</p>
          <button onclick="location.reload()" style="padding:8px 20px;background:#1A56DB;color:#fff;border:none;border-radius:6px;font-size:0.82rem;cursor:pointer;font-family:inherit">Coba Lagi</button>
        </div>`;
    }
    // STATE.map tetap null — guard di renderMarkers() & flyToLocation() menangani ini
  }

  bindEvents(); // selalu dijalankan
  loadData();   // selalu dijalankan
}

// Script ini di-load dengan defer, sehingga DOM sudah siap saat dieksekusi.
// Panggil init() langsung — tidak perlu menunggu DOMContentLoaded.
if (document.readyState === 'loading') {
  // Fallback: jika karena alasan tertentu DOM belum siap
  document.addEventListener('DOMContentLoaded', init);
} else {
  // Normal path dengan defer: DOM sudah siap, langsung inisialisasi
  init();
}
