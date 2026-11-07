<script setup>
import RemoteData from '../../shared/RemoteData.vue'
import AppealReview from './AppealReview.vue'
defineProps({ id: { type: String, required: true } })
</script>

<template>
  <RouterLink class="appeal-back" :to="{ name: 'appeals' }">К списку апелляций</RouterLink>
  <RemoteData :path="`/appeals/${encodeURIComponent(id)}`" v-slot="{ payload }">
    <AppealReview :key="payload.data.id" :initial="payload.data" />
  </RemoteData>
</template>

<style scoped>
.appeal-back { display:inline-flex; align-items:center; gap:7px; color:#48647f; text-decoration:none; font-size:13px }
.appeal-back::before { content:'←' }
.appeal-back:hover { color:#1768d5 }
</style>
