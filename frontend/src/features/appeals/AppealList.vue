<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import PagedList from '../../shared/PagedList.vue'
import { readAppeal } from '../../../js/appeals.js'
import { appealStatus, demoCases } from './demoCases.js'

const route = useRoute()
const serverMode = computed(() => route.query.source === 'server')

function status(item) {
  try { return appealStatus(readAppeal(item)) }
  catch { return 'Не удалось прочитать локальное решение' }
}
</script>

<template>
  <section class="appeal-list">
    <h1>Апелляции</h1>
    <nav aria-label="Источник апелляций">
      <RouterLink :to="{ name: 'appeals' }">Демопримеры</RouterLink>
      <RouterLink :to="{ name: 'appeals', query: { source: 'server' } }">Данные сервера</RouterLink>
    </nav>
    <template v-if="!serverMode">
      <p>Тестовые диалоги. Обращения и решения сохраняются в этом браузере.</p>
      <ul class="records">
        <li v-for="item in demoCases" :key="item.id">
          <RouterLink :to="{ name: 'appeal-demo-detail', params: { id: item.id } }">{{ item.title }}</RouterLink>
          <p>{{ item.criterion }} · {{ status(item) }}</p>
        </li>
      </ul>
    </template>
    <PagedList v-else path="/appeals" empty-text="Апелляций пока нет." v-slot="{ item }">
      <strong>{{ item.criterion.name }}</strong>
      <span class="meta">{{ item.status }}</span>
      <p>{{ item.comment }}</p>
    </PagedList>
  </section>
</template>
