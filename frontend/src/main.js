import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './app/App.vue'
import { routes } from './app/routes.js'
import './app/styles.css'

const router = createRouter({ history: createWebHashHistory(), routes })
createApp(App).use(router).mount('#app')
