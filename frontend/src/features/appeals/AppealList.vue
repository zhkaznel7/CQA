<script setup>
import PagedList from '../../shared/PagedList.vue'
import { statusLabel } from './appeals.js'
</script>

<template>
  <h1>Апелляции</h1>
  <PagedList path="/appeals" empty-text="Апелляций пока нет." v-slot="{ item }">
    <RouterLink :to="{ name: 'appeal', params: { id: item.id } }">{{ item.criterion.name }}</RouterLink>
    <span> · {{ statusLabel(item.status) }}</span>
    <p>{{ item.comment }}</p>
  </PagedList>
</template>
