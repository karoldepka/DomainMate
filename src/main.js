import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { installCrashReporting } from './crashReporting.js'
import './styles.css'

const app = createApp(App)
installCrashReporting(app)
app.use(createPinia()).mount('#app')
