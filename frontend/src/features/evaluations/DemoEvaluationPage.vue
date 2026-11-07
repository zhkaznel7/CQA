<script setup>
import ConversationCard from '../conversations/ConversationCard.vue'
import { conversation, demoService } from './demo.js'
</script>

<template>
  <RouterLink :to="{ name: 'conversations' }">К диалогам</RouterLink>
  <p>Демочат. Диалог и результат подготовлены вручную для проверки интерфейса.</p>
  <ConversationCard :conversation="conversation" :service="demoService" />
</template>
