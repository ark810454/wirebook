import Dexie, { type Table } from 'dexie'
import type { CanvasElement, Project, Screen } from '../types'

class WirebookDatabase extends Dexie {
  projects!: Table<Project, string>
  screens!: Table<Screen, string>
  elements!: Table<CanvasElement, string>
  constructor() { super('wirebook'); this.version(1).stores({ projects: 'id, updatedAt, favorite, deletedAt', screens: 'id, projectId, updatedAt', elements: 'id, screenId, updatedAt' }) }
}
export const db = new WirebookDatabase()
