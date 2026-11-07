<script setup>
import { ref } from 'vue'
import RemoteData from './RemoteData.vue'

defineProps({
  path: { type: String, required: true },
  emptyText: { type: String, required: true },
})
const page = ref(1)
</script>

<template>
  <RemoteData :path="`${path}${path.includes('?') ? '&' : '?'}page=${page}`" v-slot="{ payload }">
    <p v-if="!payload.data.length">{{ emptyText }}</p>
    <ul v-else class="records">
      <li v-for="item in payload.data" :key="item.id"><slot :item="item" /></li>
    </ul>
    <nav v-if="payload.pagination.totalPages > 1 || page > 1" aria-label="Страницы списка" class="pager">
      <button :disabled="page === 1" @click="page--">Назад</button>
      <span>Страница {{ page }}</span>
      <button :disabled="page >= payload.pagination.totalPages" @click="page++">Далее</button>
    </nav>
  </RemoteData>
</template>
