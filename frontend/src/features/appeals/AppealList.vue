<script setup>
import { ref } from 'vue'
import PagedList from '../../shared/PagedList.vue'
import AppIcon from '../../shared/AppIcon.vue'
import { statusLabel } from './appeals.js'

const status = ref('')
const filters = [
  { value: '', label: 'Все обращения' },
  { value: 'PENDING', label: 'На рассмотрении' },
  { value: 'ACCEPTED', label: 'Оценка изменена' },
  { value: 'REJECTED', label: 'Оценка подтверждена' },
]
</script>

<template>
  <section class="appeals-page">
    <header><h1>Апелляции</h1><p>Обращения по оценкам и решения проверяющих.</p></header>
    <section class="appeals-panel">
      <nav aria-label="Фильтр апелляций" class="appeal-tabs">
        <button v-for="filter in filters" :key="filter.value" type="button" :aria-pressed="status === filter.value" @click="status = filter.value">
          {{ filter.label }}
        </button>
      </nav>
      <PagedList :key="status" :path="status ? '/appeals?status=' + status : '/appeals'" empty-text="Апелляций пока нет.">
        <template #empty>
          <div class="empty-appeals" role="status">
            <span class="empty-symbol"><AppIcon name="scale" :size="26" /></span>
            <h2>{{ status ? 'В этом статусе пока нет обращений' : 'Апелляций пока нет.' }}</h2>
            <p v-if="!status">Оспорить оценку по критерию можно из карточки диалога.</p>
            <button v-if="status" type="button" @click="status = ''">Все обращения <AppIcon name="arrow-right" :size="15" /></button>
            <RouterLink v-else :to="{ name: 'conversations' }">Перейти к диалогам <AppIcon name="arrow-right" :size="15" /></RouterLink>
          </div>
        </template>
        <template #default="{ item }">
          <RouterLink class="appeal-entry" :to="{ name: 'appeal', params: { id: item.id } }">
            <span class="appeal-icon"><AppIcon name="chat" /></span>
            <span class="appeal-text"><strong>{{ item.criterion.name }}</strong><small>{{ item.comment }}</small></span>
            <span class="appeal-status" :data-status="item.status">{{ statusLabel(item.status) }}</span>
            <AppIcon name="chevron-right" />
          </RouterLink>
        </template>
      </PagedList>
    </section>
  </section>
</template>

<style scoped>
.appeals-page > header { margin-bottom:24px }
.appeals-page h1 { margin:0; font-size:clamp(25px,3vw,34px); letter-spacing:-.04em }
.appeals-page header p { margin:6px 0 0; color:#5f7086 }
.appeals-panel { border:1px solid #dce3ec; border-radius:10px; background:white; overflow:hidden }
.appeal-tabs { display:flex; gap:14px; padding:0 20px; border-bottom:1px solid #e2e8f0; overflow-x:auto }
.appeal-tabs button { flex:none; min-height:48px; position:relative; padding:0 3px; color:#61728a; background:transparent; border:0; border-radius:0; box-shadow:none; font-size:13px }
.appeal-tabs button::after { position:absolute; content:""; bottom:0; left:4px; right:4px; height:3px; border-radius:4px 4px 0 0; background:#1768d5; transform:scaleX(0); transition:transform .2s }
.appeal-tabs button[aria-pressed=true] { color:#164f99; font-weight:650 }
.appeal-tabs button[aria-pressed=true]::after { transform:scaleX(1) }
.appeals-panel :deep(.records) { margin:0; padding:0; list-style:none }
.appeals-panel :deep(.records > li) { padding:0; border-bottom:1px solid #edf0f5 }
.empty-appeals { padding:clamp(42px,7vw,76px) 18px; display:flex; flex-direction:column; align-items:center; text-align:center; gap:10px }
.empty-symbol { width:54px; height:54px; display:grid; place-items:center; border:1px solid #d7e5f7; box-shadow:0 4px 14px #1d47750b; color:#3a72be; background:#f0f6ff; border-radius:14px }
.empty-appeals h2 { margin:5px 0 0; font-size:19px; color:#213752; letter-spacing:-.02em }
.empty-appeals p { margin:0; color:#61738a; font-size:14px }
.empty-appeals a,.empty-appeals button { margin-top:6px; display:inline-flex; align-items:center; gap:7px; padding:8px 12px; text-decoration:none; color:#1762b9; background:#fff; border:1px solid #ccdbee; border-radius:5px; font-size:13px; font-weight:600 }
.empty-appeals a:hover,.empty-appeals button:hover { background:#f1f7ff }
.appeals-panel :deep(.pager) { padding:0 20px }
.appeal-entry { display:flex; align-items:center; gap:12px; padding:18px 20px; color:#203450; text-decoration:none; transition:background .18s }
.appeal-entry:hover { background:#f4f8ff }
.appeal-entry > svg { width:16px; color:#6e8299 }
.appeal-icon { flex:none; display:grid; place-items:center; width:38px; height:38px; border-radius:8px; color:#7957ad; background:#f1edfa }
.appeal-icon svg { width:18px }
.appeal-text { flex:1; min-width:0; display:grid; gap:4px }
.appeal-text strong { overflow-wrap:anywhere }
.appeal-text small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#68798c }
.appeal-status { border-radius:20px; background:#ecf1f7; color:#54647a; padding:4px 9px; font-size:12px; font-weight:600 }
.appeal-status[data-status=PENDING] { color:#886011; background:#fff5d9 }
.appeal-status[data-status=ACCEPTED] { color:#14765b; background:#e8f6ef }
@media(max-width:600px){ .appeal-entry { flex-wrap:wrap } .appeal-status { max-width:125px } }
</style>
