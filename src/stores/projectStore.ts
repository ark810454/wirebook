import { defineStore } from 'pinia'
import { db } from '../db/database'
import type { CanvasElement, DeviceType, Project, Screen } from '../types'
const id = () => crypto.randomUUID()
const sizes: Record<DeviceType, [number, number]> = { iphone: [390, 844], android: [412, 915], desktop: [1280, 800], tablet: [768, 1024], custom: [640, 840] }

export const useProjectStore = defineStore('projects', {
  state: () => ({ projects: [] as Project[], screens: [] as Screen[], ready: false }),
  getters: { activeProjects: (state) => state.projects.filter((project) => !project.deletedAt) },
  actions: {
    async hydrate() { this.projects = await db.projects.toArray(); this.screens = await db.screens.toArray(); this.ready = true },
    async createProject(input: { name: string; description: string; deviceType: DeviceType }) { const now = Date.now(); const project: Project = { id: id(), ...input, createdAt: now, updatedAt: now, favorite: false }; await db.projects.add(project); this.projects.unshift(project); return project },
    async createScreen(projectId: string, name: string, deviceType: DeviceType, customSize?: [number, number]) { const now = Date.now(); const [width, height] = customSize ?? sizes[deviceType]; const screen: Screen = { id: id(), projectId, name, deviceType, width, height, createdAt: now, updatedAt: now }; await db.screens.add(screen); this.screens.unshift(screen); return screen },
    async toggleFavorite(project: Project) { project.favorite = !project.favorite; project.updatedAt = Date.now(); await db.projects.put(project); this.projects = [...this.projects] },
    async trashProject(project: Project) { project.deletedAt = Date.now(); await db.projects.put(project); this.projects = [...this.projects] },
    async restoreProject(project: Project) { delete project.deletedAt; await db.projects.put(project); this.projects = [...this.projects] },
    async deleteProject(project: Project) { await db.transaction('rw', db.projects, db.screens, db.elements, async () => { const screenIds = (await db.screens.where('projectId').equals(project.id).toArray()).map((screen) => screen.id); await db.elements.where('screenId').anyOf(screenIds).delete(); await db.screens.where('projectId').equals(project.id).delete(); await db.projects.delete(project.id) }); this.projects = this.projects.filter((item) => item.id !== project.id); this.screens = this.screens.filter((item) => item.projectId !== project.id) },
    async saveElements(screenId: string, elements: CanvasElement[]) { const records = JSON.parse(JSON.stringify(elements)) as CanvasElement[]; await db.transaction('rw', db.elements, async () => { await db.elements.where('screenId').equals(screenId).delete(); await db.elements.bulkPut(records) }) },
    loadElements: (screenId: string) => db.elements.where('screenId').equals(screenId).toArray(),
    async updateScreen(screen: Screen) { screen.updatedAt = Date.now(); await db.screens.put(JSON.parse(JSON.stringify(screen))); const idx = this.screens.findIndex(s => s.id === screen.id); if (idx !== -1) this.screens[idx] = { ...screen } },
    async deleteScreen(screenId: string) { await db.transaction('rw', db.screens, db.elements, async () => { await db.elements.where('screenId').equals(screenId).delete(); await db.screens.delete(screenId) }); this.screens = this.screens.filter(s => s.id !== screenId) },
  },
})
