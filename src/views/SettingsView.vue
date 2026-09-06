<script setup lang="ts">
import AppShell from '../components/AppShell.vue'
import { useSettingsStore } from '../stores/settingsStore'
const settings = useSettingsStore()
</script>
<template><AppShell><section class="settings"><p class="eyebrow">PREFERENCES</p><h1>Settings</h1><div class="settings-card"><h3>Appearance</h3><p class="muted">Choose the workspace appearance that suits you.</p><div class="theme-options"><button :class="{active:settings.theme==='light'}" @click="settings.setTheme('light')">Light</button><button :class="{active:settings.theme==='dark'}" @click="settings.setTheme('dark')">Dark</button></div></div><div class="settings-card"><h3>Canvas</h3><label class="toggle-row">Show grid by default <input type="checkbox" checked></label></div></section></AppShell></template>
