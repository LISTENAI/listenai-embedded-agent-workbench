const DASHBOARD_SCRIPT_PATH = "/dashboard.js";

export function renderDashboardPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ListenAI Resource Manager</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe6;
        --panel: rgba(255, 252, 247, 0.92);
        --panel-strong: rgba(255, 249, 240, 0.98);
        --panel-border: rgba(28, 44, 62, 0.12);
        --text: #162031;
        --muted: #556272;
        --accent: #db6b2d;
        --accent-ink: #fff9f1;
        --ok: #2f7d4f;
        --warn: #a36a15;
        --error: #a03d33;
        --shadow: 0 20px 60px rgba(22, 32, 49, 0.08);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(219, 107, 45, 0.18), transparent 28%),
          radial-gradient(circle at top right, rgba(39, 88, 128, 0.14), transparent 22%),
          linear-gradient(180deg, #faf6ef 0%, var(--bg) 100%);
        color: var(--text);
      }

      main {
        width: min(1120px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 32px 0 48px;
      }

      .hero,
      .panel,
      .status-banner {
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 24px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(12px);
      }

      .hero {
        padding: 28px;
        display: grid;
        gap: 20px;
        margin-bottom: 20px;
      }

      .hero-top,
      .hero-meta,
      .section-head,
      .card-head,
      .meta-grid,
      .detail-row,
      .detail-grid {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: center;
        flex-wrap: wrap;
      }

      h1,
      h2,
      h3,
      h4 {
        margin: 0;
        font-family: "Space Grotesk", "Avenir Next", sans-serif;
        letter-spacing: -0.04em;
      }

      h1 {
        font-size: clamp(2.2rem, 4vw, 4rem);
        line-height: 0.92;
      }

      h2 {
        font-size: clamp(1.25rem, 2vw, 1.8rem);
      }

      h3 {
        font-size: 1rem;
      }

      h4 {
        font-size: 0.94rem;
      }

      p,
      ul,
      dl {
        margin: 0;
      }

      p {
        color: var(--muted);
      }

      .eyebrow,
      .pill,
      .signal,
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 0.92rem;
      }

      .eyebrow,
      .pill {
        background: rgba(22, 32, 49, 0.06);
        color: var(--muted);
      }

      .hero-copy {
        display: grid;
        gap: 10px;
        max-width: 760px;
      }

      .hero-actions {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }

      button {
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
        background: var(--accent);
        color: var(--accent-ink);
      }

      button:disabled {
        cursor: wait;
        opacity: 0.72;
      }

      .signal[data-state="healthy"],
      .signal[data-state="connected"],
      .pill[data-state="healthy"],
      .badge.ready,
      .badge.active,
      .badge.available,
      .badge.connected,
      .badge.none {
        color: var(--ok);
        background: rgba(47, 125, 79, 0.12);
      }

      .signal[data-state="attention"],
      .signal[data-state="reconnecting"],
      .pill[data-state="attention"],
      .pill[data-state="degraded"],
      .badge.degraded,
      .badge.overdue,
      .badge.expiring,
      .badge.lease-overdue,
      .badge.lease-missing,
      .badge.attention,
      .badge.warning,
      .badge.allocated,
      .badge.occupied,
      .badge.device {
        color: var(--warn);
        background: rgba(163, 106, 21, 0.12);
      }

      .signal[data-state="error"],
      .pill[data-state="error"],
      .pill[data-state="missing"],
      .pill[data-state="unsupported"],
      .badge.unsupported,
      .badge.missing,
      .badge.error,
      .badge.disconnected,
      .badge.lease-orphaned,
      .badge.backend {
        color: var(--error);
        background: rgba(160, 61, 51, 0.12);
      }

      .badge {
        min-width: 0;
        justify-content: center;
        padding: 6px 10px;
        font-size: 0.82rem;
        font-weight: 700;
      }

      .status-banner {
        display: grid;
        gap: 14px;
        padding: 18px 20px;
        background:
          linear-gradient(135deg, rgba(255, 244, 228, 0.96), rgba(255, 252, 247, 0.98));
      }

      .status-meta,
      .badge-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 14px;
      }

      .metric {
        padding: 18px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(22, 32, 49, 0.08);
        display: grid;
        gap: 10px;
      }

      .metric[data-tone="healthy"] {
        border-color: rgba(47, 125, 79, 0.22);
      }

      .metric[data-tone="attention"] {
        border-color: rgba(163, 106, 21, 0.26);
      }

      .metric[data-tone="error"] {
        border-color: rgba(160, 61, 51, 0.28);
      }

      .metric-label {
        display: block;
        color: var(--muted);
        font-size: 0.88rem;
      }

      .metric-value {
        font: 700 2rem/1 "Space Grotesk", "Avenir Next", sans-serif;
      }

      .metric-detail {
        min-height: 2.5em;
        font-size: 0.92rem;
      }

      .layout {
        display: grid;
        grid-template-columns: 1.45fr 1fr;
        gap: 20px;
        margin-top: 20px;
      }

      .panel {
        padding: 22px;
      }

      .stack {
        display: grid;
        gap: 20px;
      }

      .meta-note,
      .detail-label,
      .detail-note,
      .device-name small,
      .device-subtitle {
        color: var(--muted);
      }

      .device-grid,
      .list {
        display: grid;
        gap: 12px;
        margin-top: 16px;
      }

      .device-card,
      .list-item {
        padding: 16px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.7);
        border: 1px solid rgba(22, 32, 49, 0.08);
        display: grid;
        gap: 14px;
      }

      .device-card[data-state="available"] {
        border-color: rgba(47, 125, 79, 0.18);
      }

      .device-card[data-state="occupied"],
      .device-card[data-state="degraded"],
      .device-card[data-state="lease-overdue"] {
        border-color: rgba(163, 106, 21, 0.24);
      }

      .device-card[data-state="unsupported"],
      .device-card[data-state="disconnected"],
      .device-card[data-state="lease-missing"],
      .device-card[data-state="lease-orphaned"] {
        border-color: rgba(160, 61, 51, 0.28);
      }

      .device-name {
        display: grid;
        gap: 4px;
      }

      .device-subtitle {
        font-size: 0.9rem;
      }

      .detail-grid {
        align-items: stretch;
      }

      .detail-block {
        min-width: min(100%, 220px);
        flex: 1 1 220px;
        display: grid;
        gap: 6px;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(244, 239, 230, 0.62);
      }

      .detail-block strong,
      .detail-value,
      .detail-stack {
        color: var(--text);
      }

      .detail-stack {
        display: grid;
        gap: 4px;
      }

      .diagnostic-list {
        margin: 0;
        padding-left: 18px;
        display: grid;
        gap: 6px;
      }

      .diagnostic-list li {
        color: var(--text);
      }

      .empty {
        color: var(--muted);
        font-style: italic;
      }

      code {
        font-size: 0.82rem;
      }

      @media (max-width: 820px) {
        main {
          width: min(100vw - 20px, 100%);
          padding-top: 20px;
        }

        .layout {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero" aria-labelledby="system-dashboard-title">
        <div class="hero-top">
          <div class="hero-copy">
            <span class="eyebrow">Read-only system dashboard</span>
            <h1 id="system-dashboard-title">System dashboard</h1>
            <p>
              The resource manager browser entrypoint leads with overall system status, then drills
              into occupancy, owner identity, lease timing, and diagnostics without exposing any
              mutating controls beyond a snapshot refresh.
            </p>
          </div>
          <div class="hero-actions">
            <span class="signal" id="stream-status" data-state="reconnecting">Connecting live stream...</span>
            <span class="pill" id="last-updated">Waiting for first snapshot</span>
            <button id="refresh-button" type="button">Refresh snapshot</button>
          </div>
        </div>

        <section class="status-banner" aria-labelledby="system-status-title">
          <div class="section-head">
            <div>
              <p class="meta-note">Current system posture</p>
              <h2 id="system-status-title">System status</h2>
            </div>
            <span class="pill" id="system-status-pill" data-state="attention">Awaiting snapshot</span>
          </div>
          <p id="system-status-summary">
            Waiting for the authoritative dashboard snapshot from <code>/dashboard-snapshot</code>.
          </p>
          <div class="status-meta">
            <span class="pill" id="provider-summary">Provider unknown</span>
            <span class="pill" id="backend-summary">Backend unknown</span>
          </div>
        </section>

        <section aria-labelledby="system-overview-title">
          <div class="section-head">
            <div>
              <p class="meta-note">Landing view</p>
              <h2 id="system-overview-title">System overview</h2>
            </div>
            <p class="meta-note">Snapshot-derived counts from the S01 contract.</p>
          </div>
          <div id="overview" class="grid" aria-live="polite"></div>
        </section>
      </section>

      <section class="layout">
        <article class="panel">
          <div class="section-head">
            <div>
              <p class="meta-note">Per-device detail</p>
              <h2>Device occupancy</h2>
            </div>
            <p class="meta-note">Owner identity, readiness, and lease timing from the live snapshot.</p>
          </div>
          <p id="device-summary" class="meta-note">Waiting for the device occupancy snapshot.</p>
          <div id="device-cards" class="device-grid" aria-live="polite">
            <p class="empty">No dashboard snapshot loaded yet.</p>
          </div>
        </article>

        <aside class="stack">
          <section class="panel">
            <div class="section-head">
              <div>
                <p class="meta-note">Backend truth</p>
                <h2>Backend readiness</h2>
              </div>
              <p class="meta-note">Probe results grouped by platform and backend.</p>
            </div>
            <div id="backend-readiness" class="list">
              <p class="empty">No backend readiness data loaded yet.</p>
            </div>
          </section>

          <section class="panel">
            <div class="section-head">
              <div>
                <p class="meta-note">Global alerts</p>
                <h2>Diagnostics</h2>
              </div>
              <p class="meta-note">Warnings and errors that affect the whole system.</p>
            </div>
            <div id="diagnostics" class="list">
              <p class="empty">No diagnostics loaded yet.</p>
            </div>
          </section>
        </aside>
      </section>
    </main>
    <script type="module" src="${DASHBOARD_SCRIPT_PATH}"></script>
  </body>
</html>`;
}

export function renderDashboardScript(): string {
  return `const overview = document.querySelector("#overview");
const deviceCards = document.querySelector("#device-cards");
const deviceSummary = document.querySelector("#device-summary");
const backendReadiness = document.querySelector("#backend-readiness");
const diagnostics = document.querySelector("#diagnostics");
const refreshButton = document.querySelector("#refresh-button");
const lastUpdated = document.querySelector("#last-updated");
const streamStatus = document.querySelector("#stream-status");
const systemStatusPill = document.querySelector("#system-status-pill");
const systemStatusSummary = document.querySelector("#system-status-summary");
const providerSummary = document.querySelector("#provider-summary");
const backendSummary = document.querySelector("#backend-summary");

const leaseAttentionStates = new Set(["lease-missing", "lease-overdue", "lease-orphaned"]);

let liveEvents = null;
let lastSequence = 0;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function badgeClass(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function pluralize(count, singular, plural = singular + "s") {
  return count === 1 ? singular : plural;
}

function summarizeScope(prefix, kinds, emptyLabel) {
  if (!Array.isArray(kinds) || kinds.length === 0) {
    return prefix + ' ' + emptyLabel;
  }

  if (kinds.length === 1) {
    return prefix + ' ' + kinds[0];
  }

  return prefix + ' ' + kinds.join(' + ');
}

function setStreamStatus(state, message) {
  streamStatus.dataset.state = state;
  streamStatus.textContent = message;
}

function formatMoment(value, fallback = "Not reported") {
  return value ? escapeHtml(value) : '<span class="empty">' + escapeHtml(fallback) + '</span>';
}

function formatOwner(owner) {
  if (!owner) {
    return '<div class="detail-stack"><strong>Unowned</strong><span class="detail-note">No owner identity reported by the lease manager or provider.</span></div>';
  }

  return '<div class="detail-stack"><strong>'
    + escapeHtml(owner.skillId)
    + '</strong><span class="detail-note">Owner source: '
    + escapeHtml(owner.source)
    + '</span></div>';
}

function formatLease(lease) {
  const rows = ['<div class="badge-row"><span class="badge ' + badgeClass(lease.state) + '">' + escapeHtml(lease.state) + '</span>'];

  if (lease.timeoutMs !== null) {
    rows.push('<span class="badge attention">' + escapeHtml(String(lease.timeoutMs)) + ' ms timeout</span>');
  }

  rows.push('</div>');
  rows.push('<div class="detail-stack">');
  rows.push('<span><span class="detail-label">Lease ID</span><br />' + (lease.leaseId ? '<code>' + escapeHtml(lease.leaseId) + '</code>' : '<span class="empty">None</span>') + '</span>');
  rows.push('<span><span class="detail-label">Created</span><br />' + formatMoment(lease.createdAt) + '</span>');
  rows.push('<span><span class="detail-label">Last heartbeat</span><br />' + formatMoment(lease.lastRefreshedAt) + '</span>');
  rows.push('<span><span class="detail-label">Expires</span><br />' + formatMoment(lease.expiresAt) + '</span>');

  if (typeof lease.remainingMs === "number") {
    rows.push('<span><span class="detail-label">Remaining</span><br />' + escapeHtml(String(lease.remainingMs)) + ' ms</span>');
  } else {
    rows.push('<span><span class="detail-label">Remaining</span><br /><span class="empty">No active lease timer</span></span>');
  }

  rows.push('</div>');
  return rows.join('');
}

function summarizeBackendReadiness(snapshot) {
  if (!snapshot.backendReadiness.length) {
    return {
      value: 'Unknown',
      detail: 'No backend probes reported',
      tone: 'attention'
    };
  }

  if (snapshot.overview.backendMissing > 0) {
    return {
      value: 'Missing',
      detail: snapshot.overview.backendMissing + ' backend ' + pluralize(snapshot.overview.backendMissing, 'probe') + ' missing',
      tone: 'error'
    };
  }

  if (snapshot.overview.backendUnsupported > 0) {
    return {
      value: 'Unsupported',
      detail: snapshot.overview.backendUnsupported + ' backend ' + pluralize(snapshot.overview.backendUnsupported, 'probe') + ' unsupported',
      tone: 'error'
    };
  }

  if (snapshot.overview.backendDegraded > 0) {
    return {
      value: 'Degraded',
      detail: snapshot.overview.backendDegraded + ' backend ' + pluralize(snapshot.overview.backendDegraded, 'probe') + ' degraded',
      tone: 'attention'
    };
  }

  return {
    value: 'Ready',
    detail: snapshot.overview.backendReady + ' backend ' + pluralize(snapshot.overview.backendReady, 'probe') + ' ready',
    tone: 'healthy'
  };
}

function summarizeSystemStatus(snapshot) {
  const backend = summarizeBackendReadiness(snapshot);
  const unavailableOrAbnormal = snapshot.devices.filter((device) => {
    return device.readinessBadge !== 'ready' || leaseAttentionStates.has(device.occupancyState);
  }).length;
  const providerKinds = snapshot.inventoryScope?.providerKinds ?? [];
  const backendKinds = snapshot.inventoryScope?.backendKinds ?? [];
  const usesSimulatedProvider = providerKinds.includes('fake') || backendKinds.includes('fake');
  const missingBackendTelemetry = snapshot.backendReadiness.length === 0;

  if (snapshot.overview.backendMissing > 0 || snapshot.overview.backendUnsupported > 0) {
    return {
      tone: 'error',
      label: 'Backend attention required',
      summary: unavailableOrAbnormal > 0
        ? unavailableOrAbnormal + ' device ' + pluralize(unavailableOrAbnormal, 'entry', 'entries') + ' unavailable or abnormal, plus backend blockers.'
        : 'Backend blockers are preventing a fully healthy system posture.',
      unavailableOrAbnormal,
      backend
    };
  }

  if (usesSimulatedProvider || missingBackendTelemetry) {
    return {
      tone: 'attention',
      label: 'Attention needed',
      summary: usesSimulatedProvider
        ? 'A fake provider/backend is serving this snapshot, so hardware readiness is not being probed.'
        : 'Backend readiness has not reported any probe results yet.',
      unavailableOrAbnormal,
      backend
    };
  }

  if (
    unavailableOrAbnormal > 0 ||
    snapshot.overview.backendDegraded > 0 ||
    snapshot.overview.overdueLeases > 0 ||
    snapshot.overview.missingLeases > 0
  ) {
    return {
      tone: 'attention',
      label: 'Attention needed',
      summary: unavailableOrAbnormal > 0
        ? unavailableOrAbnormal + ' device ' + pluralize(unavailableOrAbnormal, 'entry', 'entries') + ' unavailable or abnormal.'
        : 'Backend or lease telemetry needs attention before the system is healthy.',
      unavailableOrAbnormal,
      backend
    };
  }

  return {
    tone: 'healthy',
    label: 'Healthy',
    summary: 'Connected devices, backend readiness, and leases all look nominal.',
    unavailableOrAbnormal,
    backend
  };
}

function buildOverviewCards(snapshot) {
  const system = summarizeSystemStatus(snapshot);
  const supportedDevices = Math.max(0, snapshot.overview.totalDevices - snapshot.overview.unsupportedDevices);

  return [
    {
      label: 'Supported devices',
      value: supportedDevices,
      detail: snapshot.overview.unsupportedDevices > 0
        ? snapshot.overview.unsupportedDevices + ' unsupported ' + pluralize(snapshot.overview.unsupportedDevices, 'device') + ' still surfaced below with blocker state'
        : 'All discovered devices are supported',
      tone: snapshot.overview.unsupportedDevices > 0 ? 'attention' : 'healthy'
    },
    {
      label: 'Connected',
      value: snapshot.overview.connectedDevices,
      detail: snapshot.overview.disconnectedDevices > 0
        ? snapshot.overview.disconnectedDevices + ' disconnected ' + pluralize(snapshot.overview.disconnectedDevices, 'device')
        : 'No disconnected devices reported',
      tone: snapshot.overview.disconnectedDevices > 0 ? 'attention' : 'healthy'
    },
    {
      label: 'Allocated',
      value: snapshot.overview.occupiedDevices,
      detail: snapshot.overview.availableDevices + ' device ' + pluralize(snapshot.overview.availableDevices, 'slot') + ' still available',
      tone: snapshot.overview.occupiedDevices > 0 ? 'attention' : 'healthy'
    },
    {
      label: 'Unavailable / abnormal',
      value: system.unavailableOrAbnormal,
      detail: system.unavailableOrAbnormal > 0
        ? 'Includes degraded, disconnected, unsupported, and lease-attention states'
        : 'No abnormal device states in the current snapshot',
      tone: system.unavailableOrAbnormal > 0 ? 'attention' : 'healthy'
    },
    {
      label: 'Backend readiness',
      value: system.backend.value,
      detail: system.backend.detail,
      tone: system.backend.tone
    },
    {
      label: 'Active leases',
      value: snapshot.overview.activeLeases,
      detail: snapshot.overview.overdueLeases > 0
        ? snapshot.overview.overdueLeases + ' overdue, ' + snapshot.overview.expiringSoon + ' expiring soon'
        : snapshot.overview.expiringSoon + ' expiring soon',
      tone: snapshot.overview.overdueLeases > 0 ? 'attention' : 'healthy'
    }
  ];
}

function renderOverview(snapshot) {
  const cards = buildOverviewCards(snapshot);
  overview.innerHTML = cards
    .map((card) => {
      return '<article class="metric" data-tone="'
        + escapeHtml(card.tone)
        + '"><span class="metric-label">'
        + escapeHtml(card.label)
        + '</span><span class="metric-value">'
        + escapeHtml(String(card.value))
        + '</span><p class="metric-detail">'
        + escapeHtml(card.detail)
        + '</p></article>';
    })
    .join('');
}

function summarizeDeviceList(snapshot) {
  const supportedDevices = Math.max(0, snapshot.overview.totalDevices - snapshot.overview.unsupportedDevices);
  const pieces = [
    supportedDevices + ' supported ' + pluralize(supportedDevices, 'device') + ' in the live snapshot',
    snapshot.overview.occupiedDevices + ' allocated',
    snapshot.overview.disconnectedDevices + ' disconnected'
  ];

  if (snapshot.overview.unsupportedDevices > 0) {
    pieces.push(snapshot.overview.unsupportedDevices + ' unsupported');
  }

  if (snapshot.overview.missingLeases > 0 || snapshot.overview.overdueLeases > 0) {
    pieces.push(snapshot.overview.missingLeases + ' missing lease, ' + snapshot.overview.overdueLeases + ' overdue lease');
  }

  deviceSummary.textContent = pieces.join(' - ');
}

function getPrimaryDeviceState(device) {
  if (device.occupancyState === 'lease-orphaned') {
    return 'lease-orphaned';
  }

  if (device.occupancyState === 'lease-missing') {
    return 'lease-missing';
  }

  if (device.occupancyState === 'lease-overdue') {
    return 'lease-overdue';
  }

  if (device.readinessBadge === 'unsupported') {
    return 'unsupported';
  }

  if (device.readinessBadge === 'disconnected') {
    return 'disconnected';
  }

  if (device.readinessBadge === 'degraded') {
    return 'degraded';
  }

  if (device.occupancyState === 'occupied') {
    return 'occupied';
  }

  return 'available';
}

function formatDeviceDiagnostics(device) {
  if (!device.diagnostics.length) {
    return '<p class="empty">No per-device diagnostics reported.</p>';
  }

  return '<ul class="diagnostic-list">'
    + device.diagnostics
      .map((diagnostic) => {
        return '<li><span class="badge '
          + badgeClass(diagnostic.severity)
          + '">'
          + escapeHtml(diagnostic.severity)
          + '</span> <strong>'
          + escapeHtml(diagnostic.code)
          + '</strong> - '
          + escapeHtml(diagnostic.message)
          + '</li>';
      })
      .join('')
    + '</ul>';
}

function renderDevices(snapshot) {
  summarizeDeviceList(snapshot);

  if (!snapshot.devices.length) {
    deviceCards.innerHTML = '<p class="empty">No devices in the authoritative snapshot.</p>';
    return;
  }

  deviceCards.innerHTML = snapshot.devices
    .map((device) => {
      const primaryState = getPrimaryDeviceState(device);
      return '<article class="device-card" data-state="'
        + escapeHtml(primaryState)
        + '"><div class="card-head"><div class="device-name"><strong>'
        + escapeHtml(device.label || device.deviceId)
        + '</strong><small>'
        + escapeHtml(device.deviceId)
        + '</small><span class="device-subtitle">'
        + escapeHtml(device.capabilityType)
        + ' via '
        + escapeHtml(device.providerKind || 'unknown-provider')
        + ' / '
        + escapeHtml(device.backendKind || 'unknown-backend')
        + '</span></div><div class="badge-row"><span class="badge '
        + badgeClass(device.readinessBadge)
        + '">'
        + escapeHtml(device.readinessBadge)
        + '</span><span class="badge '
        + badgeClass(device.occupancyState)
        + '">'
        + escapeHtml(device.occupancyState)
        + '</span><span class="badge '
        + badgeClass(device.connectionState)
        + '">'
        + escapeHtml(device.connectionState)
        + '</span></div></div><div class="detail-grid"><section class="detail-block"><span class="detail-label">Owner identity</span>'
        + formatOwner(device.owner)
        + '</section><section class="detail-block"><span class="detail-label">Lease timing</span>'
        + formatLease(device.lease)
        + '</section></div><div class="detail-grid"><section class="detail-block"><span class="detail-label">Occupancy truth</span><div class="detail-stack"><span><strong>'
        + escapeHtml(device.allocationState)
        + '</strong></span><span class="detail-note">Readiness '
        + escapeHtml(device.readinessBadge)
        + ' with occupancy '
        + escapeHtml(device.occupancyState)
        + '</span><span class="detail-note">Last seen '
        + formatMoment(device.lastSeenAt)
        + '</span><span class="detail-note">Updated '
        + formatMoment(device.updatedAt, 'Update timestamp unavailable')
        + '</span></div></section><section class="detail-block"><span class="detail-label">Device diagnostics</span>'
        + formatDeviceDiagnostics(device)
        + '</section></div></article>';
    })
    .join('');
}

function renderBackendReadiness(snapshot) {
  if (!snapshot.backendReadiness.length) {
    backendReadiness.innerHTML = '<p class="empty">No backend readiness diagnostics reported.</p>';
    return;
  }

  backendReadiness.innerHTML = snapshot.backendReadiness
    .map((backend) => {
      const details = [];
      if (backend.executablePath) {
        details.push('<span><span class="detail-label">Executable</span><br /><code>' + escapeHtml(backend.executablePath) + '</code></span>');
      }
      if (backend.version) {
        details.push('<span><span class="detail-label">Version</span><br />' + escapeHtml(backend.version) + '</span>');
      }
      details.push('<span><span class="detail-label">Checked</span><br />' + escapeHtml(backend.checkedAt) + '</span>');

      return '<article class="list-item"><div class="list-item-head"><strong>'
        + escapeHtml(backend.platform)
        + ' / '
        + escapeHtml(backend.backendKind)
        + '</strong><span class="badge '
        + badgeClass(backend.readiness)
        + '">'
        + escapeHtml(backend.readiness)
        + '</span></div><div class="detail-grid">'
        + details.join('')
        + '</div><div><span class="detail-label">Backend diagnostics</span>'
        + (backend.diagnostics.length
          ? '<ul class="diagnostic-list">'
            + backend.diagnostics.map((diagnostic) => {
              return '<li><span class="badge '
                + badgeClass(diagnostic.severity)
                + '">'
                + escapeHtml(diagnostic.severity)
                + '</span> <strong>'
                + escapeHtml(diagnostic.code)
                + '</strong> - '
                + escapeHtml(diagnostic.message)
                + '</li>';
            }).join('')
            + '</ul>'
          : '<p class="empty">No backend diagnostics.</p>')
        + '</div></article>';
    })
    .join('');
}

function renderDiagnostics(snapshot) {
  if (!snapshot.diagnostics.length) {
    diagnostics.innerHTML = '<p class="empty">No global diagnostics reported.</p>';
    return;
  }

  diagnostics.innerHTML = snapshot.diagnostics
    .map((diagnostic) => {
      const meta = [diagnostic.target];
      if (diagnostic.deviceId) {
        meta.push(diagnostic.deviceId);
      }
      if (diagnostic.backendKind) {
        meta.push(diagnostic.backendKind);
      }
      if (diagnostic.platform) {
        meta.push(diagnostic.platform);
      }

      return '<article class="list-item"><div class="list-item-head"><strong>'
        + escapeHtml(diagnostic.code)
        + '</strong><span class="badge '
        + badgeClass(diagnostic.severity)
        + '">'
        + escapeHtml(diagnostic.severity)
        + '</span></div><div>'
        + escapeHtml(diagnostic.message)
        + '</div><div class="meta-note">Target '
        + escapeHtml(meta.join(' / '))
        + '</div></article>';
    })
    .join('');
}

function applySnapshot(snapshot, sourceLabel) {
  const system = summarizeSystemStatus(snapshot);

  renderOverview(snapshot);
  renderDevices(snapshot);
  renderBackendReadiness(snapshot);
  renderDiagnostics(snapshot);

  lastUpdated.textContent = sourceLabel + ' ' + snapshot.generatedAt;
  systemStatusPill.dataset.state = system.tone;
  systemStatusPill.textContent = system.label;
  systemStatusSummary.textContent = system.summary;
  providerSummary.textContent = summarizeScope('Provider', snapshot.inventoryScope?.providerKinds, 'unknown');
  backendSummary.textContent = summarizeScope('Backend', snapshot.inventoryScope?.backendKinds, 'unknown');
}

async function loadSnapshot(sourceLabel = 'Updated') {
  refreshButton.disabled = true;
  refreshButton.textContent = 'Refreshing...';

  try {
    const response = await fetch('/dashboard-snapshot', {
      headers: { accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error('Dashboard snapshot request failed with status ' + response.status);
    }

    const snapshot = await response.json();
    applySnapshot(snapshot, sourceLabel);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastUpdated.textContent = 'Snapshot load failed';
    systemStatusPill.dataset.state = 'error';
    systemStatusPill.textContent = 'Snapshot unavailable';
    systemStatusSummary.textContent = message;
    deviceSummary.textContent = 'Device occupancy unavailable';
    deviceCards.innerHTML = '<p class="empty">Device occupancy could not be loaded.</p>';
    backendReadiness.innerHTML = '<p class="empty">Backend readiness unavailable.</p>';
    diagnostics.innerHTML = '<article class="list-item"><div class="list-item-head"><strong>dashboard-load-failed</strong><span class="badge error">error</span></div><div>' + escapeHtml(message) + '</div></article>';
    setStreamStatus('error', 'Snapshot fetch failed');
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = 'Refresh snapshot';
  }
}

function connectLiveUpdates() {
  if (!("EventSource" in window)) {
    setStreamStatus('error', 'Live stream unsupported');
    return;
  }

  setStreamStatus('reconnecting', 'Connecting live stream...');
  liveEvents = new EventSource('/dashboard-events');

  liveEvents.addEventListener('snapshot', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.sequence <= lastSequence) {
      return;
    }

    lastSequence = payload.sequence;
    applySnapshot(payload.snapshot, 'Live ' + payload.reason + ' at');
    setStreamStatus('connected', 'Live stream connected');
  });

  liveEvents.addEventListener('error', () => {
    setStreamStatus('reconnecting', 'Reconnecting live stream...');
  });
}

refreshButton.addEventListener('click', () => {
  void loadSnapshot('Manual refresh at');
});

void loadSnapshot('Initial snapshot at');
connectLiveUpdates();
`;
}
