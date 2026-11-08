<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { fetchDialogs } from '../features/conversations/conversation-catalog.js'
import AppIcon from '../shared/AppIcon.vue'
import { sections } from './sections.js'

const router = useRouter()
const controller = new AbortController()
const modal = ref(null)
const searchInput = ref(null)
const mode = ref('search')
const query = ref('')
const dialogs = ref([])
const loadError = ref(false)
const loading = ref(false)
const needle = computed(() => query.value.trim().toLowerCase())
const destinations = computed(() => sections.filter(s => s.label.toLowerCase().includes(needle.value)))
const matches = computed(() => needle.value ? dialogs.value.filter(d => d.externalId.toLowerCase().includes(needle.value)).slice(0, 12) : [])

let catalogLoaded = false
async function loadCatalog() {
  if (catalogLoaded || loading.value) return
  loading.value = true
  loadError.value = false
  try {
    dialogs.value = await fetchDialogs(controller.signal)
    catalogLoaded = true
  } catch { loadError.value = true }
  finally { loading.value = false }
}
async function openDialog(which) {
  catalogLoaded = false
  mode.value = which
  query.value = ''
  if (!modal.value.open) modal.value.showModal()
  await nextTick()
  if (which === 'search') searchInput.value?.focus()
}
watch(needle, value => { if (value) loadCatalog() })
function navigate(path) {
  modal.value.close()
  router.push(path)
}

function focusFirstResult() {
  modal.value.querySelector('.search-results > button')?.focus()
}
function openFirstResult() {
  modal.value.querySelector('.search-results > button')?.click()
}
onBeforeUnmount(() => controller.abort())
defineExpose({ open: openDialog })
</script>

<template>
  <dialog ref="modal" class="suite-dialog" :aria-label="mode === 'search' ? 'Поиск' : mode === 'sections' ? 'Разделы' : 'Справка'" @click.self="modal.close()">
      <div class="dialog-content">
        <div class="dialog-title"><h2>{{ mode === 'search' ? 'Поиск' : mode === 'sections' ? 'Разделы приложения' : 'Справка' }}</h2><button class="icon-plain" aria-label="Закрыть" @click="modal.close()"><AppIcon name="close" /></button></div>
        <template v-if="mode === 'help'">
          <p>В «Диалогах» откройте переписку или запись звонка, выберите версию чек-листа и нажмите «Оценить».</p>
          <p>Спорный критерий можно отправить на пересмотр. Решение проверяющего появится в разделе «Апелляции».</p>
          <p><kbd>Ctrl K</kbd> — найти диалог по ID или перейти в раздел.</p>
        </template>
        <template v-else>
          <input v-if="mode === 'search'" ref="searchInput" v-model="query" type="search" @keydown.down.prevent="focusFirstResult" @keydown.enter.prevent="openFirstResult" placeholder="Название раздела или ID диалога" aria-label="Название раздела или ID диалога" />
          <div class="search-results">
            <button v-for="s in destinations" :key="s.path" @click="navigate(s.path)"><AppIcon :name="s.icon" />{{ s.label }}<AppIcon name="chevron-right" :size="15" /></button>
            <button v-for="d in matches" :key="d.id" @click="navigate({ name:'conversation', params:{id:d.id} })"><AppIcon name="message" />{{ d.externalId }}<small>{{ d.language }}</small></button>
            <p v-if="needle && loading" role="status">Поиск диалогов…</p>
            <p v-else-if="needle && loadError" role="status">Не удалось загрузить диалоги. <button @click="loadCatalog">Повторить</button></p>
            <p v-else-if="!destinations.length && !matches.length">Совпадений нет.</p>
          </div>
        </template>
      </div>
    </dialog>
</template>
