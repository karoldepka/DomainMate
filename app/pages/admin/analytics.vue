<script setup>
const tokenStorageKey = 'domainmate.adminToken'
const token = ref('')
const tokenInput = ref('')
const summary = ref(null)
const loading = ref(false)
const error = ref('')

const eventLabels = {
  search_run: 'Searches run',
  domain_favorited: 'Domains favorited',
  price_comparison_opened: 'Price comparisons opened',
  pro_prompt_shown: 'Pro prompt shown',
}

const totalEvents = computed(() => (summary.value?.totals || []).reduce((sum, row) => sum + Number(row.count), 0))
const todayKey = computed(() => new Date().toISOString().slice(0, 10))
const eventsToday = computed(() => summary.value?.daily?.find((row) => row.date === todayKey.value)?.count || 0)
const maxDaily = computed(() => Math.max(1, ...(summary.value?.daily || []).map((row) => Number(row.count))))

async function load() {
  if (!token.value) return
  loading.value = true
  error.value = ''
  try {
    const data = await $fetch('/api/admin/analytics', { headers: { 'x-admin-token': token.value } })
    summary.value = data
    if (import.meta.client) localStorage.setItem(tokenStorageKey, token.value)
  } catch {
    error.value = 'Invalid token, or the server has no ADMIN_TOKEN configured.'
    summary.value = null
  } finally {
    loading.value = false
  }
}

function submitToken() {
  token.value = tokenInput.value.trim()
  load()
}

onMounted(() => {
  const fromQuery = new URLSearchParams(window.location.search).get('token')
  const stored = localStorage.getItem(tokenStorageKey)
  token.value = fromQuery || stored || ''
  tokenInput.value = token.value
  if (token.value) load()
})
</script>

<template>
  <main class="admin-page">
    <h1>Analytics</h1>

    <div v-if="!summary" class="token-form">
      <label for="admin-token">Admin token</label>
      <input id="admin-token" v-model="tokenInput" type="password" autocomplete="off" placeholder="Paste ADMIN_TOKEN" @keyup.enter="submitToken" />
      <button type="button" :disabled="loading" @click="submitToken">{{ loading ? 'Checking…' : 'View dashboard' }}</button>
      <p v-if="error" class="admin-error">{{ error }}</p>
    </div>

    <template v-else>
      <div class="stat-tiles">
        <div class="stat-tile"><span class="stat-value">{{ totalEvents }}</span><span class="stat-label">Total events (30d)</span></div>
        <div class="stat-tile"><span class="stat-value">{{ eventsToday }}</span><span class="stat-label">Events today</span></div>
        <div class="stat-tile"><span class="stat-value">{{ summary.uniqueClients }}</span><span class="stat-label">Unique clients (30d)</span></div>
      </div>

      <section class="chart-section">
        <h2>Daily activity</h2>
        <div v-if="summary.daily.length" class="bar-chart">
          <div
            v-for="row in summary.daily"
            :key="row.date"
            class="bar"
            :style="{ height: `${(row.count / maxDaily) * 100}%` }"
            :title="`${row.date}: ${row.count}`"
          />
        </div>
        <p v-else class="admin-empty">No events in the last 30 days.</p>
      </section>

      <section class="chart-section">
        <h2>By event type</h2>
        <table v-if="summary.totals.length" class="admin-table">
          <tbody>
            <tr v-for="row in summary.totals" :key="row.name">
              <td>{{ eventLabels[row.name] || row.name }}</td>
              <td class="admin-count">{{ row.count }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="admin-empty">No events recorded yet.</p>
      </section>

      <section class="chart-section">
        <h2>Recent events</h2>
        <table v-if="summary.recent.length" class="admin-table">
          <thead><tr><th>Time</th><th>Event</th><th>Client</th><th>Properties</th></tr></thead>
          <tbody>
            <tr v-for="row in summary.recent" :key="`${row.client_id}-${row.created_at}`">
              <td>{{ new Date(Number(row.created_at)).toLocaleString() }}</td>
              <td>{{ eventLabels[row.name] || row.name }}</td>
              <td class="admin-mono">{{ String(row.client_id).slice(0, 8) }}</td>
              <td class="admin-mono">{{ JSON.stringify(row.properties) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="admin-empty">No events recorded yet.</p>
      </section>
    </template>
  </main>
</template>
