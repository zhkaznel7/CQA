<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '../shared/AppIcon.vue'
import AppCommandMenu from './AppCommandMenu.vue'
import { sections } from './sections.js'
import { getJson } from '../shared/api.js'

const route = useRoute()
const active = computed(() => sections.find(s => s.routes.includes(route.name)))
const collapsed = ref(false)
const mobileOpen = ref(false)
const commandMenu = ref(null)
const online = ref(null)
const controller = new AbortController()
const date = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
async function health() {
  try { online.value = (await getJson('/health', controller.signal)).status === 'ok' }
  catch { online.value = false }
}
function openDialog(which) {
  mobileOpen.value = false
  commandMenu.value.open(which)
}
function keydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    openDialog('search')
  }
  if (event.key === 'Escape') mobileOpen.value = false
}
watch(() => route.fullPath, () => { mobileOpen.value = false })
onMounted(() => { window.addEventListener('keydown', keydown); health() })
onBeforeUnmount(() => { controller.abort(); window.removeEventListener('keydown', keydown) })
</script>

<template>
  <div class="workspace" :class="{ 'nav-compact': collapsed, 'mobile-open': mobileOpen }">
    <a class="skip-link" href="#workspace-main" @click.prevent="$refs.main.focus()">К содержанию</a>
    <header class="suite-header">
      <button class="suite-launcher" aria-label="Открыть меню разделов" @click="openDialog('sections')"><span class="waffle" aria-hidden="true"></span></button>
      <RouterLink class="suite-brand" to="/">CQA<span class="suite-separator"></span><span>Quality Analytics</span></RouterLink>
      <button class="suite-search" aria-label="Открыть поиск" @click="openDialog('search')"><AppIcon name="search" :size="16" /><span>Поиск по рабочей области</span><kbd>Ctrl K</kbd></button>
      <div class="suite-actions">
        <span class="suite-date"><AppIcon name="calendar" :size="15" />{{ date }}</span>
        <button class="suite-help" aria-label="Справка" @click="openDialog('help')"><AppIcon name="help" /></button>
        <span class="profile-dot" aria-label="Рабочая область QA">QA</span>
      </div>
    </header>

    <aside id="workspace-nav" class="suite-sidebar" aria-label="Навигация">
      <div class="workspace-name">
        <span class="workspace-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <div><small>Рабочая область</small><strong>Контроль качества</strong></div>
      </div>
      <nav aria-label="Разделы приложения" class="suite-nav">
        <div v-for="group in ['Аналитика','Управление']" :key="group" class="suite-nav-group">
          <h2>{{ group }}</h2>
          <RouterLink v-for="s in sections.filter(item => item.group === group)" :key="s.path" :to="s.path" :title="s.label" :aria-label="s.label" :class="{ current: active === s }" :aria-current="active === s ? 'page' : undefined">
            <AppIcon :name="s.icon" :size="19" /><span>{{ s.label }}</span>
          </RouterLink>
        </div>
      </nav>
      <div class="suite-bottom">
        <button class="connection" :title="online === false ? 'Повторить проверку API' : 'Проверить соединение с API'" @click="health">
          <i :class="{ connected: online, offline: online === false }"></i><span>{{ online === null ? 'Проверка связи' : online ? 'Система онлайн' : 'API недоступен' }}</span>
        </button>
        <button class="collapse-nav" :aria-label="collapsed ? 'Развернуть меню' : 'Свернуть меню'" @click="collapsed = !collapsed"><AppIcon name="panel" :size="17" /><span>Свернуть меню</span></button>
      </div>
    </aside>
    <button v-if="mobileOpen" class="nav-scrim" aria-label="Закрыть меню" @click="mobileOpen = false"></button>
    <main id="workspace-main" ref="main" class="suite-main" tabindex="-1">
      <div class="breadcrumbs"><button class="mobile-menu" aria-controls="workspace-nav" :aria-expanded="mobileOpen" aria-label="Показать навигацию" @click="mobileOpen = true"><AppIcon name="menu" /></button>
        <RouterLink to="/">Рабочая область</RouterLink><AppIcon name="chevron-right" :size="13" /><span>{{ active?.label }}</span>
      </div>
      <RouterView v-slot="{ Component }"><div :key="route.path" class="route-page"><component :is="Component" /></div></RouterView>
    </main>

    <AppCommandMenu ref="commandMenu" />
  </div>
</template>
