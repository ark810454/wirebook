<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { FolderOpen, Star, Trash2, Settings, LayoutGrid, Plus } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import ProjectModal from './ProjectModal.vue'
import { useSettingsStore } from '../stores/settingsStore'
import logo from '../assets/icon.png'
const route = useRoute(); const showModal = ref(false)
const settings = useSettingsStore(); onMounted(() => settings.initialize())
</script>
<template>
  <aside class="sidebar"><RouterLink class="brand" to="/"><img :src="logo" alt="Wirebook">Wirebook</RouterLink><nav><RouterLink to="/" :class="{active: route.path === '/'}"><LayoutGrid :size="18"/>My projects</RouterLink><RouterLink to="/?filter=favorites"><Star :size="18"/>Favorites</RouterLink><RouterLink to="/?filter=trash"><Trash2 :size="18"/>Trash</RouterLink></nav><RouterLink class="settings-link" to="/settings"><Settings :size="18"/>Settings</RouterLink></aside>
  <main class="page"><slot /></main>
  <nav class="bottom-nav"><RouterLink to="/"><FolderOpen :size="19"/></RouterLink><RouterLink to="/?filter=favorites"><Star :size="19"/></RouterLink><button aria-label="Create project" @click="showModal = true"><Plus :size="22"/></button><RouterLink to="/?filter=trash"><Trash2 :size="19"/></RouterLink><RouterLink to="/settings"><Settings :size="19"/></RouterLink></nav>
  <ProjectModal v-model="showModal" />
</template>
