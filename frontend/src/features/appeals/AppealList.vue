<script setup>
import PagedList from '../../shared/PagedList.vue'
</script>

<template>
  <section class="appeal-list">
    <h1>Апелляции</h1>
    <PagedList path="/appeals" empty-text="Апелляций пока нет." v-slot="{ item }">
      <strong>{{ item.criterion.name }}</strong>
      <span class="meta">{{ item.status }}</span>
      <p>{{ item.comment }}</p>
    </PagedList>
  </section>
</template>
