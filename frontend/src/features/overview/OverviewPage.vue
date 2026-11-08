<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import { getJson } from '../../shared/api.js'
import AppIcon from '../../shared/AppIcon.vue'
import { channelOf, fetchDialogs } from '../conversations/conversation-catalog.js'

const channelTypes = {
  chat: { name: 'Чаты', label: 'Чат', color: '#3375de', icon: 'message' },
  voice: { name: 'Звонки', label: 'Звонок', color: '#21adab', icon: 'phone' },
  other: { name: 'Другие', label: 'Другой', color: '#838ba2', icon: 'messages' },
}
const languageNames = { RU: 'Русский', KZ: 'Казахский', EN: 'Английский' }
const languageColors = { RU: '#3779df', KZ: '#7865cf', EN: '#23a8a6' }
const fmt = new Intl.NumberFormat('ru-RU')
const percent = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const snapshot = shallowRef(null)
const busy = ref(false)
const failure = ref('')
const dimension = ref('language')
const channelFilter = ref('all')
const hoveredLanguage = ref(null)
const focusedLanguage = ref(null)
let controller

function groupName(value) {
  return !value || value === '__legacy__' ? 'Без группы' : value
}
function displayDate(value) {
  const d = new Date(value)
  return value && Number.isFinite(+d) ? dateFormat.format(d) : '—'
}
async function refresh() {
  if (busy.value) return
  controller = new AbortController()
  const { signal } = controller
  busy.value = true
  failure.value = ''
  try {
    const [dialogs, checklists, appeals] = await Promise.all([
      fetchDialogs(signal),
      getJson('/checklists?pageSize=1', signal),
      getJson('/appeals?status=PENDING&pageSize=1', signal),
    ])
    if (!signal.aborted) snapshot.value = {
      dialogs, checklistCount: checklists.pagination.total,
      pending: appeals.pagination.total, updated: new Date(),
    }
  } catch (error) {
    if (!signal.aborted) failure.value = error instanceof TypeError ? 'Не удалось подключиться к серверу.' : error.message
  } finally {
    busy.value = false
  }
}
onMounted(refresh)
onBeforeUnmount(() => controller?.abort())

const dialogs = computed(() => snapshot.value?.dialogs ?? [])
const activeChannels = computed(() => Object.keys(channelTypes).filter(k => k !== 'other' || dialogs.value.some(d => channelOf(d.channel) === 'other')))
const metrics = computed(() => [
  { label: 'Всего диалогов', value: dialogs.value.length, icon: 'messages', hue: 'blue', to: { name: 'conversations' } },
  { label: 'Голосовые звонки', value: dialogs.value.filter(d => channelOf(d.channel) === 'voice').length, icon: 'phone', hue: 'teal' },
  { label: 'Версии чек-листов', value: snapshot.value?.checklistCount, icon: 'clipboard', hue: 'violet', to: { name: 'checklists' } },
  { label: 'Открытые апелляции', value: snapshot.value?.pending, icon: 'scale', hue: 'amber', to: { name: 'appeals' } },
])
const languages = computed(() => {
  const counts = new Map()
  for (const item of dialogs.value) {
    const key = item.language || '—'
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  let from = 0
  return [...counts].sort(([a, n], [b, m]) => m - n || (languageNames[a] ?? a).localeCompare(languageNames[b] ?? b, 'ru')).map(([key, count]) => {
    const share = 100 * count / dialogs.value.length
    const segment = { key, name: languageNames[key] ?? key, count, share, from, color: languageColors[key] ?? '#858da4' }
    from += share
    return segment
  })
})
const activeLanguage = computed(() => languages.value.find(s => s.key === (hoveredLanguage.value ?? focusedLanguage.value)))
const chartRows = computed(() => {
  const groups = new Map()
  for (const item of dialogs.value) {
    const key = dimension.value === 'language' ? item.language || '—' : groupName(item.groupId)
    if (!groups.has(key)) groups.set(key, { key, label: dimension.value === 'language' ? languageNames[key] ?? key : key, chat: 0, voice: 0, other: 0, total: 0 })
    const group = groups.get(key)
    group[channelOf(item.channel)]++
    group.total++
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'ru'))
})
const scale = computed(() => {
  const max = Math.max(1, ...chartRows.value.flatMap(row => activeChannels.value.map(key => row[key])))
  const magnitude = 10 ** Math.floor(Math.log10(max / 4))
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map(n => n * magnitude).find(n => n >= max / 4))
  return step * 4
})
const tableRows = computed(() => dialogs.value.filter(d => channelFilter.value === 'all' || channelFilter.value === channelOf(d.channel)).slice(0, 5))
</script>

<template>
  <section class="overview" aria-labelledby="overview-title">
    <header class="overview-head">
      <div><h1 id="overview-title">Обзор качества</h1><p>Диалоги, каналы и обращения на пересмотр</p></div>
      <button class="refresh" :disabled="busy" type="button" @click="refresh">
        <AppIcon name="refresh" :class="{ spin: busy }" />Обновить
      </button>
    </header>
    <p v-if="failure" class="notice" role="alert">{{ failure }} Повторите загрузку кнопкой «Обновить».</p>
    <div class="kpi-grid" :aria-busy="busy">
      <component :is="card.to ? RouterLink : 'div'" v-for="(card, index) in metrics" :key="card.label" v-bind="card.to ? { to: card.to } : {}" class="kpi panel" :class="'kpi-' + card.hue" :style="{ '--delay': index * 45 + 'ms' }">
        <div class="kpi-top"><span class="metric-icon"><AppIcon :name="card.icon" /></span><span>{{ card.label }}</span></div>
        <div class="kpi-bottom"><strong>{{ snapshot ? fmt.format(card.value) : '—' }}</strong><AppIcon v-if="card.to" name="chevron-right" /></div>
      </component>
    </div>

    <div class="overview-charts">
      <section class="panel plot-panel">
        <header class="panel-heading">
          <div><h2>Каналы коммуникации</h2><p>Распределение диалогов {{ dimension === 'language' ? 'по языкам' : 'по группам' }}</p></div>
          <div class="segments" aria-label="Группировка диаграммы">
            <button v-for="opt in [{ key: 'language', label: 'Языки' }, { key: 'group', label: 'Группы' }]" :key="opt.key" :aria-pressed="dimension === opt.key" @click="dimension = opt.key">{{ opt.label }}</button>
          </div>
        </header>
        <div class="series"><span v-for="key in activeChannels" :key="key"><i :style="{ backgroundColor: channelTypes[key].color }"></i>{{ channelTypes[key].name }}</span></div>
        <div v-if="chartRows.length" class="chart-scroller">
          <div :key="dimension" class="column-chart" :style="{ minWidth: Math.max(0, chartRows.length * 76) + 'px' }" role="group" aria-label="Количество диалогов по каналам">
            <div v-for="tick in [4,3,2,1,0]" :key="tick" class="tick" :style="{ top: (100 - tick * 25) + '%' }"><span>{{ fmt.format(tick * scale / 4) }}</span></div>
            <div class="plot-columns">
              <div v-for="row in chartRows" :key="row.key" class="bar-group">
                <div class="bars">
                  <div v-for="key in activeChannels" :key="key" class="bar" :style="{ height: (100 * row[key] / scale) + '%', backgroundColor: channelTypes[key].color }" :title="row.label + ' · ' + channelTypes[key].name + ': ' + row[key]">
                    <span>{{ row[key] }}</span><span class="sr">{{ channelTypes[key].name }}</span>
                  </div>
                </div>
                <span class="x-label">{{ row.label }}</span>
              </div>
            </div>
          </div>
        </div>
        <p v-else class="empty">{{ busy ? 'Загрузка диаграммы…' : 'Нет данных для диаграммы.' }}</p>
      </section>

      <section class="panel language-panel">
        <header class="panel-heading"><div><h2>Языки диалогов</h2><p>Доля каждого языка в выборке</p></div></header>
        <div class="donut">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle class="ring-base" cx="60" cy="60" r="49" />
            <circle v-for="s in languages" :key="s.key" cx="60" cy="60" r="49" pathLength="100" fill="none"
              class="ring-sector" :class="{ dimmed: activeLanguage && activeLanguage.key !== s.key, highlighted: activeLanguage?.key === s.key }"
              :stroke="s.color" stroke-width="13" :stroke-dasharray="Math.max(0, s.share - (languages.length > 1 ? 0.75 : 0)) + ' 100'"
              :stroke-dashoffset="-s.from" :style="{ '--sweep-delay': (s.from * 4) + 'ms' }" transform="rotate(-90 60 60)">
              <title>{{ s.name }} · {{ s.count }}</title>
            </circle>
          </svg>
          <div :key="activeLanguage?.key ?? 'all'" class="ring-label">
            <strong>{{ activeLanguage ? fmt.format(activeLanguage.count) : snapshot ? fmt.format(dialogs.length) : '—' }}</strong>
            <span>{{ activeLanguage?.name ?? 'диалогов' }}</span>
          </div>
        </div>
        <ul v-if="languages.length" class="language-list">
          <li v-for="s in languages" :key="s.key">
            <RouterLink :to="{ name: 'conversations', query: { language: s.key } }" class="language-entry"
              :aria-label="'Открыть диалоги: ' + s.name + ', ' + s.count"
              @mouseenter="hoveredLanguage = s.key" @mouseleave="hoveredLanguage = null"
              @focus="focusedLanguage = s.key" @blur="focusedLanguage = null">
              <i :style="{ backgroundColor: s.color }"></i><span>{{ s.name }}</span><b>{{ fmt.format(s.count) }}</b><span class="pc">{{ percent.format(s.share) }}%</span>
            </RouterLink>
          </li>
        </ul>
        <p v-else class="empty">{{ busy ? 'Загрузка…' : 'Нет данных о языках.' }}</p>
      </section>
    </div>

    <section class="panel recent-panel">
      <header class="panel-heading">
        <div><h2>Последние диалоги</h2><p>Недавно добавленные в систему</p></div>
        <RouterLink class="all-link" :to="{ name: 'conversations' }">Все диалоги <AppIcon name="arrow-right" /></RouterLink>
      </header>
      <div v-if="dialogs.length" class="table-scroll">
        <table><thead><tr><th scope="col">Диалог</th><th scope="col">
          <select v-model="channelFilter" aria-label="Фильтр последних диалогов по каналу"><option value="all">Канал</option><option v-for="key in activeChannels" :key="key" :value="key">{{ channelTypes[key].name }}</option></select>
        </th><th scope="col">Язык</th><th scope="col">Группа</th><th scope="col">Добавлен</th></tr></thead>
        <tbody><tr v-for="item in tableRows" :key="item.id">
          <td><RouterLink :to="{ name: 'conversation', params: { id: item.id } }" class="record-link"><span class="record-icon" :class="channelOf(item.channel)"><AppIcon :name="channelTypes[channelOf(item.channel)].icon" /></span>{{ item.externalId }}</RouterLink></td>
          <td>{{ channelTypes[channelOf(item.channel)].label }}</td>
          <td><span class="language-tag">{{ item.language || '—' }}</span></td>
          <td>{{ groupName(item.groupId) }}</td><td>{{ displayDate(item.createdAt) }}</td>
        </tr><tr v-if="!tableRows.length"><td colspan="5">Диалогов этого канала пока нет.</td></tr></tbody></table>
      </div>
      <p v-else class="empty">{{ busy ? 'Загрузка диалогов…' : 'Диалоги пока не добавлены.' }}</p>
    </section>
    <p v-if="snapshot" class="sync"><AppIcon name="clock" /> Данные обновлены в {{ timeFormat.format(snapshot.updated) }}</p>
  </section>
</template>

<style scoped src="./overview.css"></style>
