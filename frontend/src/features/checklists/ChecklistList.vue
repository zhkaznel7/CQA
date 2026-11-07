<script setup>
import PagedList from '../../shared/PagedList.vue'
import AppIcon from '../../shared/AppIcon.vue'
</script>

<template>
  <section class="checklist-list">
    <header class="list-heading">
      <div><h1>Чек-листы</h1><p>Критерии, веса и версии для оценки диалогов.</p></div>
      <RouterLink class="create-checklist" :to="{ name: 'checklist-new' }"><span aria-hidden="true">+</span> Создать чек-лист</RouterLink>
    </header>
    <section class="checklist-library">
      <h2><AppIcon name="layers" /> Все версии</h2>
      <PagedList path="/checklists" empty-text="Чек-листов пока нет." v-slot="{ item }">
        <RouterLink class="checklist-entry" :to="{ name: 'checklist-editor', params: { id: item.id } }">
          <span class="file-icon"><AppIcon name="clipboard" /></span>
          <span class="entry-name"><strong>{{ item.name }}</strong><small>{{ item.key }}</small></span>
          <span class="version">Версия {{ item.version }}</span>
          <AppIcon name="chevron-right" />
        </RouterLink>
      </PagedList>
    </section>
  </section>
</template>

<style scoped>
.list-heading { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-bottom:24px }
.list-heading h1 { margin:0; font-size:clamp(25px,3vw,34px); letter-spacing:-.04em }
.list-heading p { margin:6px 0 0; color:#5f7086 }
.create-checklist { display:inline-flex; align-items:center; gap:8px; background:#1768d5; color:white; border-radius:6px; padding:10px 16px; font-size:14px; font-weight:600; text-decoration:none; transition:background .18s,box-shadow .18s }
.create-checklist:hover { background:#1158b8; box-shadow:0 3px 10px #1457a529 }
.create-checklist span { font-size:19px; line-height:1 }
.checklist-library { background:white; border:1px solid #dce3ec; border-radius:10px; overflow:hidden }
.checklist-library h2 { margin:0; display:flex; align-items:center; gap:10px; padding:18px 22px; font-size:17px; border-bottom:1px solid #e3e8ef }
.checklist-library h2 svg { width:19px; color:#1768d5 }
.checklist-library :deep(.records) { list-style:none; margin:0; padding:0 }
.checklist-library :deep(.records li) { padding:0; border-bottom:1px solid #edf0f5 }
.checklist-library :deep(.records li:last-child) { border:0 }
.checklist-library :deep(> p), .checklist-library :deep(.pager) { margin:16px 22px }
.checklist-entry { display:flex; align-items:center; gap:13px; padding:17px 22px; text-decoration:none; color:#263852; transition:background .18s }
.checklist-entry:hover { background:#f4f8ff }
.checklist-entry > svg { width:17px; color:#69819c }
.file-icon { width:38px; height:42px; background:#e9f2ff; color:#1768d5; border-radius:7px; display:grid; place-items:center; flex:none }
.file-icon svg { width:20px }
.entry-name { min-width:0; flex:1; display:grid; gap:4px; overflow-wrap:anywhere }
.entry-name small { color:#66798e; font-size:12px }
.version { white-space:nowrap; font-size:12px; font-weight:600; background:#edf2f8; color:#526781; padding:4px 8px; border-radius:5px }
</style>
