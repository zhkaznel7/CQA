<script setup>
import RemoteData from '../../shared/RemoteData.vue'
import AppealReview from './AppealReview.vue'
defineProps({ id: { type: String, required: true } })
</script>

<template>
  <RouterLink :to="{ name: 'appeals' }">К списку апелляций</RouterLink>
  <RemoteData :path="`/appeals/${encodeURIComponent(id)}`" v-slot="{ payload }">
    <AppealReview :key="payload.data.id" :initial="payload.data" />
  </RemoteData>
</template>
