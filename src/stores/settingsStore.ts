import { defineStore } from 'pinia'

export type Theme = 'light' | 'dark'

export const useSettingsStore = defineStore('settings', {
  state: () => ({ theme: 'light' as Theme }),
  actions: {
    initialize() { const saved = localStorage.getItem('wirebook-theme') as Theme | null; this.setTheme(saved === 'dark' ? 'dark' : 'light') },
    setTheme(theme: Theme) { this.theme = theme; document.documentElement.dataset.theme = theme; localStorage.setItem('wirebook-theme', theme) },
  },
})
