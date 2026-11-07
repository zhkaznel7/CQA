<script setup>
import AudioReview from './AudioReview.vue'
import { demoRecording } from './demo/recording.js'
</script>

<template>
  <RouterLink :to="{ name: 'conversations' }">К диалогам</RouterLink>
  <h1>Демозвонок</h1>
  <p>Синтетическая запись. Замечания анализатора подготовлены для демонстрации.</p>
  <AudioReview :recording="demoRecording" />
</template>
