<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../../shared/AppIcon.vue'
import RemoteData from '../../shared/RemoteData.vue'
import { getJson } from '../../shared/api.js'
import { channelOf, fetchDialogs } from './conversation-catalog.js'
import { languageName } from './conversation-labels.js'
import ConversationTable from './ConversationTable.vue'

const route = useRoute()
const router = useRouter()
const channels = [
  { key: '', label: 'Все каналы', icon: 'layers' },
  { key: 'agent chat', label: 'Чаты', icon: 'chat' },
  { key: 'voice call', label: 'Звонки', icon: 'phone' },
]
const languages = ['RU', 'KZ', 'EN']
const channel = computed(() => {
  const kind = channelOf(route.query.channel)
  return channels.find(item => item.key && channelOf(item.key) === kind)?.key ?? ''
})
const language = computed(() => languages.includes(route.query.language) ? route.query.language : '')
const group = computed(() => typeof route.query.group_id === 'string' ? route.query.group_id : '')
const groupError = ref('')
const page = computed(() => {
  const number = Number(route.query.page)
  return Number.isInteger(number) && number >= 1 && number <= 100000 ? number : 1
})
const path = computed(() => {
  const params = new URLSearchParams()
  if (!channel.value) params.set('page', String(page.value))
  if (language.value) params.set('language', language.value)
  if (group.value) params.set('group_id', group.value)
  return '/conversations' + (params.size ? '?' + params : '')
})
// The API filters channel names literally. Read the language group once so the
// UI can combine legacy aliases, then paginate the complete set of matches.
function loadGroup(_path, signal) {
  return fetchDialogs(signal, language.value, group.value)
}

function applyGroup(event) {
  const value = new FormData(event.currentTarget).get('group_id')
  if (value && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value)) {
    groupError.value = 'Используйте group_id организаторов: до 200 латинских букв, цифр, _ или -.'
    return
  }
  groupError.value = ''
  setFilter('group_id', value)
}

function setFilter(key, value) {
  router.push({ name: 'conversations', query: { ...route.query, [key]: value || undefined, page: undefined } })
}
function goPage(next) {
  router.push({ name: 'conversations', query: { ...route.query, page: next > 1 ? next : undefined } })
}
</script>

<template>
  <section class="dialog-registry">
    <header class="dialog-page-heading">
      <div><h1>Диалоги</h1><p>Переписки и записи звонков для проверки качества.</p></div>
      <RouterLink to="/datasets" class="import-link">Загрузить набор</RouterLink>
    </header>
    <div class="dialog-panel">
      <div class="dialog-toolbar">
        <form @submit.prevent="applyGroup">
          <label>Группа организаторов
            <input name="group_id" :value="group" maxlength="200" placeholder="Все группы; DEV или выданный group_id" />
          </label>
          <button type="submit">Применить группу</button>
          <p v-if="groupError" role="alert">{{ groupError }}</p>
        </form>
        <div class="dialog-segments" role="group" aria-label="Канал диалога">
          <button v-for="item in channels" :key="item.key" type="button" :aria-pressed="channel === item.key"
            @click="setFilter('channel', item.key)">
            <AppIcon :name="item.icon" />{{ item.label }}
          </button>
        </div>
        <label class="dialog-language">
          <AppIcon name="globe" />
          <select aria-label="Язык диалогов" :value="language" @change="setFilter('language', $event.target.value)">
            <option value="">Все языки</option>
            <option v-for="lang in languages" :key="lang" :value="lang">{{ languageName(lang) }}</option>
          </select>
        </label>
      </div>
      <RemoteData :path="path" :load="channel ? loadGroup : getJson" v-slot="{ payload }">
        <ConversationTable :source="payload" :channel="channel" :page="page" @go-page="goPage" />
      </RemoteData>
    </div>
  </section>
</template>

<style src="./conversation-list.css"></style>
