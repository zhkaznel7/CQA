<script setup>
import { computed } from 'vue'
import AppIcon from '../../shared/AppIcon.vue'
import { channelOf } from './conversation-catalog.js'
import { channelIcon, channelName, dateLabel, groupName, languageName } from './conversation-labels.js'

const props = defineProps({
  source: { type: [Object, Array], required: true },
  channel: { type: String, default: '' },
  page: { type: Number, required: true },
})
const emit = defineEmits(['goPage'])
const pageSize = 20
const payload = computed(() => {
  if (!Array.isArray(props.source)) return props.source
  const matches = props.source.filter(item => channelOf(item.channel) === channelOf(props.channel))
  const start = (props.page - 1) * pageSize
  return {
    data: matches.slice(start, start + pageSize),
    pagination: { total: matches.length, totalPages: Math.ceil(matches.length / pageSize) },
  }
})
</script>

<template>
  <div v-if="payload.data.length" class="dialog-table-scroll">
    <table class="dialog-table" aria-label="Список диалогов">
      <thead><tr><th scope="col">Диалог</th><th scope="col">Канал</th><th scope="col">Язык</th><th scope="col">Группа</th><th scope="col">Добавлен</th></tr></thead>
      <tbody>
        <tr v-for="(item, i) in payload.data" :key="item.id" :style="{ '--order': Math.min(i, 5) }">
          <td>
            <RouterLink :to="{ name: 'conversation', params: { id: item.id } }" class="dialog-link">
              <span class="dialog-channel-icon" :class="{ 'is-call': channelIcon(item.channel) === 'phone' }"><AppIcon :name="channelIcon(item.channel)" /></span>
              {{ item.externalId }}
            </RouterLink>
          </td>
          <td>{{ channelName(item.channel) }}</td>
          <td>{{ languageName(item.language) }}</td>
          <td><span class="dialog-group">{{ groupName(item.groupId) }}</span></td>
          <td>{{ dateLabel(item.createdAt) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <p v-else class="dialog-empty">Диалогов по выбранным условиям нет.</p>
  <footer class="dialog-table-footer">
    <span>Найдено диалогов <strong>{{ payload.pagination.total ?? payload.data.length }}</strong></span>
    <div v-if="payload.pagination.totalPages > 1 || page > 1" class="dialog-pager">
      <button type="button" aria-label="Предыдущая страница" :disabled="page <= 1" @click="emit('goPage', page - 1)"><AppIcon name="chevron-right" class="dialog-flip" /></button>
      <span>{{ page }} / {{ payload.pagination.totalPages }}</span>
      <button type="button" aria-label="Следующая страница" :disabled="page >= payload.pagination.totalPages" @click="emit('goPage', page + 1)"><AppIcon name="chevron-right" /></button>
    </div>
  </footer>
</template>
