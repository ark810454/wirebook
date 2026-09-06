import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '../views/DashboardView.vue'
import ProjectView from '../views/ProjectView.vue'
import EditorView from '../views/EditorView.vue'
import SettingsView from '../views/SettingsView.vue'
export default createRouter({ history: createWebHistory(), routes: [{ path: '/', component: DashboardView }, { path: '/project/:id', component: ProjectView }, { path: '/project/:projectId/screen/:screenId', component: EditorView }, { path: '/settings', component: SettingsView }] })
